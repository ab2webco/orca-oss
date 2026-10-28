import { describe, expect, it } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { gameStopTargetsOf } from '../../shared/orchestrator-game-fleet-verbs'
import type { GameAgent } from '../../shared/orchestrator-game-state'
import { stopOne, type GameStopWorker } from './orchestrator-game-stop'

function fakeClient(results: Record<string, unknown>) {
  const calls: [string, unknown][] = []
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { id: 'r', ok: true, result: results[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const remoteMember = {
  paneKey: 'remote:ctx_826',
  displayName: 'ORCA-826 restart',
  agentType: null,
  state: 'done',
  toolName: null,
  isLeader: false,
  isMember: true,
  remote: { host: 'imac', stateKnown: false },
  terminalHandle: 'term_remote_826'
} as GameAgent

const worker = (state: string): GameStopWorker => ({
  dispatchId: 'ctx_826',
  agentTerminalHandle: 'term_remote_826',
  workerState: state,
  terminalState: null
})

// Why: the remote handle resolves against the local runtime as terminal_handle_stale (ORCA-790).
describe('game stop on a remote member', () => {
  const target = () =>
    gameStopTargetsOf({ agents: [remoteMember], lead: undefined }, 'all').targets[0]

  it('targets the remote dispatch behind the member', () => {
    expect(target().remoteDispatchId).toBe('ctx_826')
  })

  it('releases a finished remote member on its host and never closes the handle locally', async () => {
    const { client, calls } = fakeClient({
      'orchestration.workerRelease': { dispatchId: 'ctx_826', state: 'released' }
    })

    const entry = await stopOne(client, target(), [worker('succeeded')])

    expect(calls).toEqual([['orchestration.workerRelease', { dispatch: 'ctx_826' }]])
    expect(entry).toMatchObject({
      outcome: 'stopped',
      dispatchId: 'ctx_826',
      dispatchState: 'released'
    })
  })

  it('stops a live remote member before releasing it', async () => {
    const { client, calls } = fakeClient({
      'orchestration.workerStop': { state: 'stopped', processAction: 'closed_agent_terminal' },
      'orchestration.workerRelease': { dispatchId: 'ctx_826', state: 'released' }
    })

    await stopOne(client, target(), [worker('ready')])

    expect(calls.map(([method]) => method)).toEqual([
      'orchestration.workerStop',
      'orchestration.workerRelease'
    ])
  })

  it('fails by name when the host keeps the member', async () => {
    const { client } = fakeClient({
      'orchestration.workerRelease': {
        dispatchId: 'ctx_826',
        state: 'retained',
        reason: 'federation_unsupported',
        recovery: 'update Orca on imac'
      }
    })

    const entry = await stopOne(client, target(), [worker('succeeded')])

    expect(entry).toMatchObject({
      outcome: 'failed',
      reason: 'imac kept it (federation_unsupported): update Orca on imac'
    })
  })
})
