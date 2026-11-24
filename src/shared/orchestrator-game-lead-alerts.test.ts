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
  it("says merged only when a member's review says so, and never dropped without GitHub's word", () => {
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
    // Why #42 is not dropped: its cached review said open while #1404 had merged (ORCA-1273).
    expect(lines).toContain(
      "#42 left the merge queue and GitHub's reason was not read: check whether it merged (gh pr view 42)."
    )
    expect(lines).toContain(
      "#43 left the merge queue and GitHub's reason was not read: check whether it merged (gh pr view 43)."
    )
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

describe('a remote member whose accepted start failed later (ORCA-1398)', () => {
  // Why this shape: what remoteGameMembersOf builds for a failed start, whose host shows no terminal.
  const failed = (startError?: string, paneKey = 'remote:ctx_1') =>
    member('ORCA-9', {
      paneKey,
      state: 'done',
      terminalHandle: undefined,
      remote: {
        host: 'm1',
        environmentId: 'env_m1',
        stateKnown: true,
        gone: true,
        startFailed: true,
        ...(startError ? { startError } : {})
      }
    })

  it('raises one alert naming the member, its host and the recorded reason', () => {
    const alerts = gameLeadAlertsOf(
      stateOf([failed('The worker server reported failed: setup exited 1.')]),
      emptyGameLeadAlertMemory(),
      NOW
    )
    expect(alerts).toEqual([
      {
        key: 'start-failed:remote:ctx_1',
        line: 'ORCA-9 failed to start on m1: The worker server reported failed: setup exited 1. Find the cause before launching ORCA-9 again.'
      }
    ])
  })

  it('alerts again when a relaunch of the ticket fails while the first failed start is still listed', () => {
    const printed = new Set<string>()
    const tick = (agents: GameAgent[]) =>
      newGameLeadAlertsOf(
        gameLeadAlertsOf(stateOf(agents), emptyGameLeadAlertMemory(), NOW),
        printed
      ).map((one) => one.line)
    const first = failed('first', 'remote:ctx_1')
    expect(tick([first])).toEqual([
      'ORCA-9 failed to start on m1: first. Find the cause before launching ORCA-9 again.'
    ])
    expect(tick([first, failed('again', 'remote:ctx_2')])).toEqual([
      'ORCA-9 failed to start on m1: again. Find the cause before launching ORCA-9 again.'
    ])
  })

  it('keeps a multi-line reason on the one alert line, capped', () => {
    const [line] = linesOf(stateOf([failed(`first\n  second line\n${'x'.repeat(400)}`)]))
    expect(line).not.toContain('\n')
    expect(line).toMatch(/^ORCA-9 failed to start on m1: first second line x+…\. Find the cause/)
    expect(line.length).toBeLessThan(320)
  })

  it('says no reason was published instead of claiming none was recorded', () => {
    expect(linesOf(stateOf([failed()]))).toEqual([
      'ORCA-9 failed to start on m1 (no reason was published). Find the cause before launching ORCA-9 again.'
    ])
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

  it('names the failed checks and their run when GitHub read them (#1408)', () => {
    const failedChecks = [
      { name: 'e2e (full) / e2e 6-of-16', runId: 44962899011 },
      { name: 'e2e (full) / e2e 14-of-16', runId: 44962899011 },
      { name: 'verify', runId: 44962899011 },
      { name: 'Windows platform tests', runId: 44962899011 }
    ]
    expect(leftLine({ state: 'open', reason: 'failed_checks', actor: null, failedChecks })).toBe(
      '#42 dropped from the merge queue (failed_checks: e2e (full) / e2e 6-of-16, e2e (full) / e2e 14-of-16, verify and 1 more; run 44962899011): find why, then fix it or queue it again.'
    )
  })

  it('says neither merged nor dropped for an open PR whose removal GitHub has not recorded', () => {
    expect(leftLine({ state: 'open', reason: null, actor: null })).toBe(
      "#42 left the merge queue and GitHub's reason was not read: check whether it merged (gh pr view 42)."
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

describe('gameLeadAlertsOf: lead mail a remote member never received (ORCA-1301)', () => {
  const onM1 = (minutesAgo: number, overrides: Partial<GameAgent> = {}) =>
    member('ORCA-9', {
      remote: {
        host: 'm1',
        environmentId: 'env_m1',
        stateKnown: true,
        undeliveredSince: new Date(NOW - minutesAgo * MIN).toISOString()
      },
      ...overrides
    })

  it('alerts once mail has waited past its budget, naming the host and how to reach the pane', () => {
    expect(linesOf(stateOf([onM1(11)]))).toEqual([
      'ORCA-9 has not received lead mail for 11+ min: m1 has not taken it, so the member has not seen it. Check the host, or reach the pane: orca terminal send --environment m1 --terminal term_ORCA-9'
    ])
  })

  it('stays quiet inside the budget and for a finished member', () => {
    expect(linesOf(stateOf([onM1(5)]))).toEqual([])
    expect(linesOf(stateOf([onM1(30, { state: 'done' })]))).not.toContainEqual(
      expect.stringContaining('lead mail')
    )
  })
})

describe('gameLeadAlertsOf: open PRs past the cap (ORCA-1301)', () => {
  const withOpen = (total: number) =>
    stateOf([], {
      lead: { ...DEFAULT_GAME_LEAD, cap: 1 },
      project: { reviews: { provider: 'github', total, url: null, items: [] }, todo: null }
    })

  it('alerts once a member opens PRs past a cap of 1, and again as the count grows', () => {
    expect(linesOf(withOpen(2))).toEqual([
      "2 open PRs, past the project's cap of 1: a member opened PRs past it. Find who (gh pr list --author @me) and stop it before it opens more."
    ])
    const keys = (total: number) =>
      gameLeadAlertsOf(withOpen(total), emptyGameLeadAlertMemory(), NOW).map((one) => one.key)
    expect(keys(3)).not.toEqual(keys(2))
  })

  it('stays quiet at the cap, which launches already respect', () => {
    expect(linesOf(withOpen(1))).toEqual([])
  })
})

describe('gameLeadAlertsOf: a member waiting on the lead (ORCA-1154, folded into ORCA-1301)', () => {
  const sqliteAt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
  const waitingFor = (minutes: number, replyAlertMinutes?: number) =>
    stateOf([], {
      lead: { ...DEFAULT_GAME_LEAD, cap: 6, ...(replyAlertMinutes ? { replyAlertMinutes } : {}) },
      inboxes: [
        {
          key: 'lead',
          unread: 0,
          last: null,
          waiting: [
            {
              id: 'relay_887',
              from: 'ORCA-1299',
              subject: 'Which look?',
              at: sqliteAt(NOW - minutes * MIN)
            }
          ]
        }
      ]
    })

  it('alerts once a question has waited past 10 min, with its age and the reply to give', () => {
    expect(linesOf(waitingFor(9))).toEqual([])
    expect(linesOf(waitingFor(12))).toEqual([
      'ORCA-1299 waiting on you 12m: "Which look?". Answer it: orca orchestration reply --id relay_887'
    ])
  })

  it('prints again on a doubling backoff until the reply, and forgets it once answered', () => {
    const printed = new Set<string>()
    const newLines = (state: GameLeadAlertInput) =>
      newGameLeadAlertsOf(gameLeadAlertsOf(state, emptyGameLeadAlertMemory(), NOW), printed).map(
        (one) => one.line
      )
    expect(newLines(waitingFor(12))).toHaveLength(1)
    expect(newLines(waitingFor(15))).toEqual([])
    expect(newLines(waitingFor(21))).toEqual([
      'ORCA-1299 waiting on you 21m: "Which look?". Answer it: orca orchestration reply --id relay_887'
    ])
    expect(newLines(waitingFor(202))).toEqual([
      'ORCA-1299 waiting on you 3h22m: "Which look?". Answer it: orca orchestration reply --id relay_887'
    ])
    expect(newLines(stateOf([]))).toEqual([])
    expect(printed.size).toBe(0)
  })

  it("waits the project's replyAlertMinutes when orca.yaml sets one", () => {
    expect(linesOf(waitingFor(12, 30))).toEqual([])
    expect(linesOf(waitingFor(31, 30))).toHaveLength(1)
  })
})
