import { describe, expect, it } from 'vitest'
import {
  gameAutoReleaseCandidatesOf,
  REPORT_TURN_TAIL_MS,
  type GameMemberReport
} from './orchestrator-game-auto-release'
import type { GameAgent } from './orchestrator-game-state'

const merged = {
  provider: 'github' as const,
  number: 41,
  title: 'Cartelera',
  url: 'https://github.com/o/r/pull/41',
  state: 'merged' as const,
  ci: 'success' as const
}

const REPORTED_AT = Date.parse('2026-10-29T15:00:00Z')

const member = (overrides: Partial<GameAgent>): GameAgent => ({
  paneKey: 'pane-1',
  displayName: 'CIN-1 Cartelera',
  agentType: 'claude',
  state: 'done',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: 'term_1',
  review: merged,
  // Why: the turn that sent worker_done ends a few seconds after it.
  stateSince: REPORTED_AT + 20_000,
  ...overrides
})

const reported = (agent: GameAgent): GameMemberReport | null => ({
  dispatchId: `ctx_${agent.paneKey}`,
  at: REPORTED_AT
})

describe('gameAutoReleaseCandidatesOf (ORCA-864)', () => {
  it('picks a member whose PR merged after its worker_done', () => {
    expect(gameAutoReleaseCandidatesOf([member({})], reported)).toEqual([
      expect.objectContaining({ ticket: 'CIN-1', dispatchId: 'ctx_pane-1', why: 'PR #41 merged' })
    ])
  })

  it('picks a member whose ticket is Done even without a PR', () => {
    const done = member({
      review: undefined,
      workItem: {
        provider: 'plane',
        identifier: 'ORCA-9',
        title: 'x',
        url: 'u',
        status: 'Done',
        statusGroup: 'done'
      }
    })
    expect(gameAutoReleaseCandidatesOf([done], reported).map((one) => one.why)).toEqual([
      'ticket ORCA-9 Done'
    ])
  })

  // Why (ORCA-862): a merge does not stop the agent, and a working member must never be closed.
  it('never picks a member its live state reports working or waiting', () => {
    const busy = [member({ state: 'working' }), member({ paneKey: 'pane-2', state: 'waiting' })]
    expect(gameAutoReleaseCandidatesOf(busy, reported)).toEqual([])
  })

  it('leaves a member that never sent worker_done, or whose work has not landed', () => {
    const open = member({ paneKey: 'pane-2', review: { ...merged, state: 'open' } })
    expect(gameAutoReleaseCandidatesOf([member({}), open], () => null)).toEqual([])
    expect(gameAutoReleaseCandidatesOf([open], reported)).toEqual([])
  })

  // Why: members chain PRs after their first worker_done and sit idle while the next one's CI runs.
  describe('a member working past its worker_done (chained PRs)', () => {
    it('is kept once a turn ended after the report', () => {
      const chained = member({ state: 'idle', stateSince: REPORTED_AT + 25 * 60_000 })
      expect(gameAutoReleaseCandidatesOf([chained], reported)).toEqual([])
    })

    it('is kept while its worktree has an open PR, even with its ticket Done', () => {
      const next = member({
        review: { ...merged, number: 42, state: 'open' },
        workItem: {
          provider: 'plane',
          identifier: 'CIN-1',
          title: 'x',
          url: 'u',
          status: 'Done',
          statusGroup: 'done'
        }
      })
      expect(gameAutoReleaseCandidatesOf([next], reported)).toEqual([])
    })

    it('is kept when its host sends no turn time to tell', () => {
      expect(gameAutoReleaseCandidatesOf([member({ stateSince: undefined })], reported)).toEqual([])
    })

    it('still counts the turn that sent worker_done as the report itself', () => {
      const tail = member({ stateSince: REPORTED_AT + REPORT_TURN_TAIL_MS })
      expect(gameAutoReleaseCandidatesOf([tail], reported)).toHaveLength(1)
    })
  })

  // Why: with its host terminal gone nothing runs there, so no turn can follow the report (ORCA-943).
  it('picks a remote member whose host terminal is gone once its ticket is Done', () => {
    const gone = member({
      paneKey: 'remote:ctx_774',
      displayName: 'ORCA-774',
      review: undefined,
      stateSince: undefined,
      terminalHandle: undefined,
      remote: { host: 'm1', environmentId: 'env_m1', stateKnown: true, gone: true },
      workItem: {
        provider: 'plane',
        identifier: 'ORCA-774',
        title: 'x',
        url: 'u',
        status: 'Done',
        statusGroup: 'done'
      }
    })
    expect(gameAutoReleaseCandidatesOf([gone], reported).map((one) => one.why)).toEqual([
      'ticket ORCA-774 Done'
    ])
    expect(gameAutoReleaseCandidatesOf([{ ...gone, workItem: undefined }], reported)).toEqual([])
  })

  it('never picks the lead', () => {
    expect(gameAutoReleaseCandidatesOf([member({ isLeader: true })], reported)).toEqual([])
  })
})
