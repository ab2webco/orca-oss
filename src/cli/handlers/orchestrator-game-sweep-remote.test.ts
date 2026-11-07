import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatSweep, type GameSweepResult } from './orchestrator-game-fleet-format'
import {
  LEAD,
  fakeClient,
  freeing,
  member,
  merged,
  run,
  stateWith
} from './orchestrator-game-fleet-test-fixtures'

// Why: follow-ups share their member's remote terminal, so its handle names several dispatches and
// sweep released a newer, already released one while the row's own stayed (ORCA-1076).
describe('game sweep --close on a remote member', () => {
  const saved = { ...process.env }
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
    process.env.ORCA_PANE_KEY = 'tab:lead'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it("releases the row's own dispatch, not the newest one on its terminal", async () => {
    const agents = [
      LEAD,
      member({
        paneKey: 'remote:ctx_e42bad601c21',
        displayName: 'Daisy · ORCA-1011',
        state: 'done',
        review: merged,
        terminalHandle: 'term_56b6b93e',
        remote: { host: 'm1', stateKnown: true, ticketDone: true }
      })
    ]
    const worker = (dispatchId: string) => ({
      dispatchId,
      agentTerminalHandle: 'term_56b6b93e',
      workerState: 'succeeded',
      terminalState: 'retained'
    })
    const { client, calls } = fakeClient(stateWith({ agents }), {
      'orchestration.workerList': {
        workers: [worker('ctx_e42bad601c21'), worker('ctx_f6ba698758d8')],
        counts: {}
      },
      'orchestration.workerRelease': {
        dispatchId: 'ctx_e42bad601c21',
        state: 'released',
        processAction: 'closed_agent_terminal',
        worktreeDispatches: [{ dispatchId: 'ctx_3566aba071f0', state: 'released' }]
      }
    })

    await run('game sweep', client, [['close', true]])

    expect(freeing(calls.slice(1))).toEqual([
      ['orchestration.workerList', {}],
      ['orchestration.workerRelease', { dispatch: 'ctx_e42bad601c21' }]
    ])
    expect(JSON.parse(output.join('')).result.finished[0].closed).toEqual({
      via: 'release',
      dispatchId: 'ctx_e42bad601c21',
      state: 'released',
      worktreeDispatches: [{ dispatchId: 'ctx_3566aba071f0', state: 'released' }]
    })
  })

  it('names the other dispatches of its worktree that the release freed', () => {
    const entry = {
      row: { ticket: 'ORCA-1011', name: 'Daisy · ORCA-1011', host: 'm1' },
      reason: 'ticket done',
      pending: [],
      closed: {
        via: 'release' as const,
        dispatchId: 'ctx_e42bad601c21',
        state: 'released',
        worktreeDispatches: [{ dispatchId: 'ctx_3566aba071f0', state: 'released' }]
      }
    } as unknown as GameSweepResult['finished'][number]

    expect(formatSweep({ closed: true, finished: [entry] })).toContain(
      'release ctx_e42bad601c21 [released] with ctx_3566aba071f0 [released]'
    )
  })
})
