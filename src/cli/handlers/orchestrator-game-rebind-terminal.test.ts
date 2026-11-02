import { describe, expect, it } from 'vitest'
import { rebindTerminalOf } from './orchestrator-game-rebind-terminal'

const terminal = (handle: string, overrides: Record<string, unknown> = {}) => ({
  handle,
  worktreeId: 'wt-1297',
  tabId: `tab-${handle}`,
  leafId: `leaf-${handle}`,
  liveness: 'running' as const,
  connected: true,
  ...overrides
})

const worker = (dispatchId: string, handle: string, workerState = 'ready') => ({
  dispatchId,
  agentTerminalHandle: handle,
  workerState
})

const agent = (handle: string, state = 'done') => ({
  paneKey: `tab-${handle}:leaf-${handle}`,
  state
})

// The terminal a member whose own one was replaced runs in now (CIN-1297, ORCA-914).
describe('rebindTerminalOf', () => {
  const member = { dispatchId: 'ctx_old', terminalHandle: 'term_old', worktreeId: 'wt-1297' }

  it('takes the one live agent terminal in the member worktree that is not its old one', () => {
    expect(
      rebindTerminalOf(member, {
        terminals: [
          terminal('term_old', { liveness: 'gone', connected: false }),
          terminal('term_new'),
          terminal('term_elsewhere', { worktreeId: 'wt-other' })
        ],
        workers: [worker('ctx_old', 'term_old')],
        agents: [agent('term_new'), agent('term_elsewhere')]
      })
    ).toEqual({ handle: 'term_new' })
  })

  it('passes over a plain shell open in the same worktree', () => {
    expect(
      rebindTerminalOf(member, {
        terminals: [terminal('term_shell'), terminal('term_new')],
        workers: [worker('ctx_old', 'term_old')],
        agents: [agent('term_new')]
      })
    ).toEqual({ handle: 'term_new' })
  })

  it("never takes a terminal another live member's dispatch holds", () => {
    expect(
      rebindTerminalOf(member, {
        terminals: [terminal('term_new'), terminal('term_mate')],
        workers: [worker('ctx_old', 'term_old'), worker('ctx_mate', 'term_mate')],
        agents: [agent('term_new'), agent('term_mate')]
      })
    ).toEqual({ handle: 'term_new' })
  })

  it('refuses while its own terminal still runs, since nothing replaced it', () => {
    expect(
      rebindTerminalOf(member, {
        terminals: [terminal('term_old'), terminal('term_new')],
        workers: [worker('ctx_old', 'term_old')],
        agents: [agent('term_old'), agent('term_new')]
      })
    ).toEqual({ refusal: 'own terminal still runs', handles: [] })
  })

  it('refuses with no live agent terminal there, or with several to choose from', () => {
    expect(
      rebindTerminalOf(member, { terminals: [terminal('term_shell')], workers: [], agents: [] })
    ).toEqual({ refusal: 'no live agent terminal in its worktree', handles: [] })
    expect(
      rebindTerminalOf(member, {
        terminals: [terminal('term_a'), terminal('term_b')],
        workers: [],
        agents: [agent('term_a'), agent('term_b')]
      })
    ).toEqual({
      refusal: 'several live agent terminals in its worktree',
      handles: ['term_a', 'term_b']
    })
  })

  // Why: the start waits for its prompt, and by then the old dispatch is already stopped.
  it('refuses while the agent there is mid-turn', () => {
    for (const state of ['working', 'blocked']) {
      expect(
        rebindTerminalOf(member, {
          terminals: [terminal('term_new')],
          workers: [],
          agents: [agent('term_new', state)]
        })
      ).toEqual({
        refusal: 'its agent is mid-turn; rebind it at its prompt',
        handles: ['term_new']
      })
    }
  })
})
