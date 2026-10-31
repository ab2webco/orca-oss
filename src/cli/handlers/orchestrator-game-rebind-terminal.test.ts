import { describe, expect, it } from 'vitest'
import { rebindTerminalOf } from './orchestrator-game-rebind-terminal'

const terminal = (handle: string, overrides: Record<string, unknown> = {}) => ({
  handle,
  worktreeId: 'wt-1297',
  liveness: 'running' as const,
  connected: true,
  ...overrides
})

const worker = (dispatchId: string, handle: string, workerState = 'ready') => ({
  dispatchId,
  agentTerminalHandle: handle,
  workerState
})

// The terminal a member whose own one was replaced runs in now (CIN-1297, ORCA-914).
describe('rebindTerminalOf', () => {
  const member = { dispatchId: 'ctx_old', terminalHandle: 'term_old', worktreeId: 'wt-1297' }

  it('takes the one live terminal in the member worktree that is not its old one', () => {
    expect(
      rebindTerminalOf(member, {
        terminals: [
          terminal('term_old', { liveness: 'gone', connected: false }),
          terminal('term_new'),
          terminal('term_elsewhere', { worktreeId: 'wt-other' })
        ],
        workers: [worker('ctx_old', 'term_old')]
      })
    ).toEqual({ handle: 'term_new' })
  })

  it("never takes a terminal another live member's dispatch holds", () => {
    expect(
      rebindTerminalOf(member, {
        terminals: [terminal('term_new'), terminal('term_mate')],
        workers: [worker('ctx_old', 'term_old'), worker('ctx_mate', 'term_mate')]
      })
    ).toEqual({ handle: 'term_new' })
  })

  it('refuses while its own terminal still runs, since nothing replaced it', () => {
    expect(
      rebindTerminalOf(member, {
        terminals: [terminal('term_old'), terminal('term_new')],
        workers: [worker('ctx_old', 'term_old')]
      })
    ).toEqual({ refusal: 'own terminal still runs', handles: [] })
  })

  it('refuses with no live terminal there, or with several to choose from', () => {
    expect(rebindTerminalOf(member, { terminals: [], workers: [] })).toEqual({
      refusal: 'no live terminal in its worktree',
      handles: []
    })
    expect(
      rebindTerminalOf(member, {
        terminals: [terminal('term_a'), terminal('term_b')],
        workers: []
      })
    ).toEqual({ refusal: 'several live terminals in its worktree', handles: ['term_a', 'term_b'] })
  })
})
