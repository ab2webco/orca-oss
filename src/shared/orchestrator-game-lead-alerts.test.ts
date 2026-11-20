import { describe, expect, it } from 'vitest'

import {
  GAME_LEAD_ALERT_BUDGETS_MS,
  emptyGameLeadAlertMemory,
  gameLeadAlertsOf,
  newGameLeadAlertsOf,
  type GameLeadAlertInput
} from './orchestrator-game-lead-alerts'
import { DEFAULT_GAME_LEAD } from './orchestrator-game-lead'
import type { GameQueueEntry } from './orchestrator-game-project-work'
import type { GameQueueDeparture } from './orchestrator-game-queue-departure'
import type { GameAgent, GameReview } from './orchestrator-game-state'

const NOW = Date.parse('2026-11-14T20:00:00Z')
const MIN = 60_000

const review = (number: number, state: GameReview['state'], ci: GameReview['ci'] = 'success') => ({
  provider: 'github' as const,
  number,
  title: 'x',
  url: `https://github.com/o/r/pull/${number}`,
  state,
  ci
})

const member = (ticket: string, overrides: Partial<GameAgent> = {}): GameAgent => ({
  paneKey: `p-${ticket}`,
  displayName: `${ticket} work`,
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: `term_${ticket}`,
  ...overrides
})

const entry = (
  n: number,
  state: GameQueueEntry['state'],
  since: number | null = NOW
): GameQueueEntry => ({
  id: `#${n}`,
  title: `PR ${n}`,
  url: `https://github.com/o/r/pull/${n}`,
  position: 1,
  state,
  since
})

const stateOf = (
  agents: GameAgent[],
  more: Partial<GameLeadAlertInput> = {},
  queue?: GameQueueEntry[] | null
): GameLeadAlertInput => ({
  agents,
  lead: { ...DEFAULT_GAME_LEAD, cap: 6 },
  project: {
    reviews: null,
    todo: null,
    ...(queue === undefined ? {} : { queue: { provider: 'github', entries: queue } })
  },
  ...more
})

const linesOf = (state: GameLeadAlertInput, memory = emptyGameLeadAlertMemory(), now = NOW) =>
  gameLeadAlertsOf(state, memory, now).map((one) => one.line)

describe('gameLeadAlertsOf: members (ORCA-1214)', () => {
  it('names each member the lead must act on, and nothing for a member at work', () => {
    const lines = linesOf(
      stateOf([
        member('CIN-1', { remote: { host: 'imac', stateKnown: true, gone: true } }),
        member('CIN-2', { limit: { resetsAt: null } }),
        member('CIN-3', { state: 'waiting' }),
        member('CIN-4', { state: 'idle' }),
        member('CIN-5', { state: 'idle', review: review(45, 'open', 'failure') }),
        member('CIN-6', { state: 'idle', review: review(46, 'merged') }),
        member('CIN-7', { review: review(47, 'open', 'pending') })
      ])
    )

    expect(lines).toEqual([
      expect.stringMatching(/^CIN-3 needs you: /),
      expect.stringMatching(/^CIN-2 limited: /),
      expect.stringMatching(
        /^CIN-1 gone from imac: .*\. Compare its host worktree head with the pushed branch first\.$/
      ),
      'CIN-4 idle with no PR: push',
      'CIN-5 CI red on #45 open: give it its next step now.',
      expect.stringMatching(
        /^CIN-6 PR #46 merged: ticket to done with a comment, remove its worktree and branch, free it/
      )
    ])
  })

  it('names a paused member and a launch queued past its budget, counted from when the watch saw it', () => {
    const memory = emptyGameLeadAlertMemory()
    const state = stateOf([], {
      pausedMembers: [
        {
          ticket: 'CIN-8',
          name: null,
          agent: null,
          account: null,
          branch: null,
          lastState: 'failed',
          resumable: true,
          runId: 'run_1',
          since: '2026-11-14T19:00:00Z'
        }
      ],
      queuedMembers: [{ ticket: 'CIN-9', name: null, position: 2, waitingOn: 'CIN-1 setup' }]
    })

    expect(linesOf(state, memory)).toEqual([
      'CIN-8 paused (last failed): orca game resume-members CIN-8, or --discard to free it'
    ])
    expect(linesOf(state, memory, NOW + GAME_LEAD_ALERT_BUDGETS_MS.queuedLaunch)).toContain(
      'CIN-9 launch queued 20+ min, waiting on CIN-1 setup'
    )
  })
})

describe('gameLeadAlertsOf: the merge queue (ORCA-1214)', () => {
  it('tells a drop from a merge, and does not guess for a PR it cannot see', () => {
    const memory = emptyGameLeadAlertMemory()
    const agents = [
      member('CIN-1', { review: review(41, 'merged') }),
      member('CIN-2', { review: review(42, 'open') })
    ]
    linesOf(
      stateOf(agents, {}, [entry(41, 'checks'), entry(42, 'waiting'), entry(43, 'waiting')]),
      memory
    )

    const lines = linesOf(stateOf(agents, {}, []), memory, NOW + MIN)

    expect(lines).toContain('#41 merged from the queue: close its ticket and clean up its member.')
    expect(lines).toContain(
      '#42 dropped from the merge queue: find why, then fix it or queue it again.'
    )
    expect(lines).toContain('#43 left the merge queue: check whether it merged.')
  })

  it('reads nothing as left the queue when the queue could not be read', () => {
    const memory = emptyGameLeadAlertMemory()
    linesOf(stateOf([], {}, [entry(41, 'waiting')]), memory)

    expect(linesOf(stateOf([], {}, null), memory, NOW + MIN)).toEqual([])
    expect(linesOf(stateOf([], {}), memory, NOW + MIN)).toEqual([])
    expect(memory.queue).toEqual([entry(41, 'waiting')])
  })

  it('names a failed entry, an entry past 3 h and a run past 1 h', () => {
    const memory = emptyGameLeadAlertMemory()
    const queue = [entry(41, 'failed'), entry(42, 'waiting', NOW - 181 * MIN), entry(43, 'checks')]
    linesOf(stateOf([], {}, queue), memory)

    const lines = linesOf(stateOf([], {}, queue), memory, NOW + GAME_LEAD_ALERT_BUDGETS_MS.queueRun)

    expect(lines).toEqual([
      '#41 failed in the merge queue: find the cause.',
      '#42 in the merge queue 241+ min, past its budget: find why.',
      '#43 queue run 60+ min, past its budget: check the merge_group run.'
    ])
  })
})

describe('gameLeadAlertsOf: one lead conversation in two panes (ORCA-1283)', () => {
  it('names every pane on it, first, and says nothing for one pane', () => {
    const two = stateOf([member('CIN-1', { phase: 'needs-you' } as Partial<GameAgent>)], {
      duplicateLead: { terminals: ['term_a', 'term_b'] }
    })

    expect(linesOf(two)[0]).toBe(
      'lead conversation live in 2 panes (term_a, term_b): keep one, close the others (orca terminal close --terminal <handle>).'
    )
    expect(linesOf(stateOf([], { duplicateLead: { terminals: ['term_a'] } }))).toEqual([])
    expect(linesOf(stateOf([]))).toEqual([])
  })
})

describe('newGameLeadAlertsOf', () => {
  it('prints an alert once while it holds, and again when it comes back', () => {
    const printed = new Set<string>()
    const red = { key: 'ci-red:CIN-1', line: 'CIN-1 CI red' }

    expect(newGameLeadAlertsOf([red], printed)).toEqual([red])
    expect(newGameLeadAlertsOf([red], printed)).toEqual([])
    expect(newGameLeadAlertsOf([], printed)).toEqual([])
    expect(newGameLeadAlertsOf([red], printed)).toEqual([red])
  })
})

describe('a remote member still starting (ORCA-1263)', () => {
  it('raises no gone or idle alert while its launch has not finished', () => {
    const starting = member('ORCA-9', {
      remote: { host: 'm1', environmentId: 'env_m1', stateKnown: true, starting: true }
    })
    const alerts = gameLeadAlertsOf(stateOf([starting]), emptyGameLeadAlertMemory(), NOW)
    expect(alerts).toEqual([])
  })
})

describe('gameLeadAlertsOf: why an entry left the merge queue (ORCA-1273)', () => {
  const leftLine = (departure: GameQueueDeparture): string | undefined => {
    const memory = emptyGameLeadAlertMemory()
    // Why open: the member's cached review still says open after the queue merged it (#1304).
    const agents = [member('CIN-2', { review: review(42, 'open') })]
    linesOf(stateOf(agents, {}, [entry(42, 'checks')]), memory)
    memory.departures.set('#42', departure)
    return linesOf(stateOf(agents, {}, []), memory, NOW + MIN).find((one) => one.startsWith('#42'))
  }

  it('calls a PR the queue merged merged, even while its cached review says open', () => {
    expect(leftLine({ state: 'merged', reason: 'merged', actor: 'github-merge-queue' })).toBe(
      '#42 merged from the queue: close its ticket and clean up its member.'
    )
  })

  it('calls a PR the queue removed for failed checks dropped, naming the reason', () => {
    expect(leftLine({ state: 'open', reason: 'failed_checks', actor: 'github-merge-queue' })).toBe(
      '#42 dropped from the merge queue (failed_checks): find why, then fix it or queue it again.'
    )
  })

  it('calls a PR a person took out dequeued by that person', () => {
    expect(leftLine({ state: 'open', reason: 'manual', actor: 'fabolivar' })).toBe(
      '#42 dequeued by fabolivar: queue it again only when that is settled.'
    )
  })

  it('reads the departure once: the next drop of the same PR is read again', () => {
    const memory = emptyGameLeadAlertMemory()
    linesOf(stateOf([], {}, [entry(42, 'checks')]), memory)
    memory.departures.set('#42', { state: 'merged', reason: 'merged', actor: null })
    linesOf(stateOf([], {}, []), memory, NOW + MIN)
    expect(memory.departures.size).toBe(0)
  })
})
