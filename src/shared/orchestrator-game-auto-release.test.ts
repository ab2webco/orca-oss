import { describe, expect, it } from 'vitest'
import { gameAutoReleaseCandidatesOf } from './orchestrator-game-auto-release'
import type { GameAgent } from './orchestrator-game-state'

const merged = {
  provider: 'github' as const,
  number: 41,
  title: 'Cartelera',
  url: 'https://github.com/o/r/pull/41',
  state: 'merged' as const,
  ci: 'success' as const
}

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
  ...overrides
})

const reported = (agent: GameAgent): string | null => `ctx_${agent.paneKey}`

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

  it('never picks the lead', () => {
    expect(gameAutoReleaseCandidatesOf([member({ isLeader: true })], reported)).toEqual([])
  })
})
