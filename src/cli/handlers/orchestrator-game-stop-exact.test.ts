import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatStop } from './orchestrator-game-stop'
import {
  LEAD,
  fakeClient,
  freeing,
  member,
  run,
  stateWith
} from './orchestrator-game-fleet-test-fixtures'

const worktree = { id: 'wt_1', branch: 'cin-1', displayName: 'cin-1' }
const worker = (dispatchId: string, handle: string | null, workerState: string) => ({
  dispatchId,
  agentTerminalHandle: handle,
  workerState,
  terminalState: 'active',
  resource: { worktreeId: 'wt_1' }
})

// Why: a stale row and the member launched after it share the ticket and the worktree (ORCA-1473 finding 1).
describe('orca game stop ends exactly the member it names (ORCA-1477)', () => {
  let output: string[] = []
  const printed = () => JSON.parse(output.join('')).result
  const saved = { ...process.env }

  const stale = (terminalHandle?: string) =>
    member({ paneKey: 'tab:old', displayName: 'CIN-1', terminalHandle, worktree })
  const fresh = member({ paneKey: 'tab:new', terminalHandle: 'term_new', worktree })
  const workers = [worker('d_old', 'term_old', 'failed'), worker('d_new', 'term_new', 'ready')]

  const stop = async (keys: string, agents: unknown[]) => {
    output = []
    const { client, calls } = fakeClient(stateWith({ agents: [LEAD, ...agents] }), {
      'orchestration.workerList': { workers, counts: {} },
      'orchestration.workerStop': {
        dispatchId: 'd_new',
        state: 'stopped',
        processAction: 'closed_agent_terminal'
      }
    })
    await run('game stop', client, [['tickets', keys]])
    return freeing(calls.slice(1)).filter(([method]) => method !== 'orchestration.workerList')
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
    process.env.ORCA_PANE_KEY = 'tab:lead'
    delete process.env.ORCA_GAME_ROLE
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('refuses the shared ticket, touches neither and lists each one by its key', async () => {
    expect(await stop('cin-1', [stale('term_old'), fresh])).toEqual([])

    expect(printed().members).toEqual([
      expect.objectContaining({
        ticket: 'cin-1',
        outcome: 'failed',
        matches: [
          { name: 'CIN-1', key: 'tab:old', host: null },
          { name: 'CIN-1 Cartelera', key: 'tab:new', host: null }
        ]
      })
    ])
    expect(formatStop(printed())).toContain('orca game stop tab:new   # CIN-1 Cartelera')
    expect(process.exitCode).toBe(1)
  })

  it('stops the stale row by its pane key, never the new member that shares its worktree', async () => {
    expect(await stop('tab:old', [stale('term_old'), fresh])).toEqual([
      ['terminal.close', { terminal: 'term_old' }]
    ])
    // Why: with no terminal, the worktree's only live dispatch belongs to the new member's pane.
    expect(await stop('tab:old', [stale(), fresh])).toEqual([])
    expect(printed().members).toEqual([
      expect.objectContaining({ name: 'CIN-1', outcome: 'already stopped' })
    ])
  })

  it('stops the new member by its dispatch id, and only its own dispatch and terminal', async () => {
    expect(await stop('d_new', [stale('term_old'), fresh])).toEqual([
      ['orchestration.workerStop', { dispatch: 'd_new' }]
    ])
    expect(printed().members).toEqual([
      expect.objectContaining({ name: 'CIN-1 Cartelera', outcome: 'stopped', dispatchId: 'd_new' })
    ])
  })
})
