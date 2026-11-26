import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../../shared/protocol-version'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import type { OrchestrationEnvironmentTransport } from '../../orchestration/environment-transport'
import { listRemoteGameMemberSources } from '../../orchestrator-game-remote-members'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATION_METHODS } from './orchestration'
import { createFederationWorkerStartRequest as startRequest } from './orchestration-federation-test-request'
import { configureWorkerRuntime } from './orchestration-federation-worker-runtime-mocks'
import { WORKTREE_METHODS } from './worktree'

// Why: a host away for hours came back with the member's terminal and worktree gone, and
// game stop kept answering not_settled instead of freeing the row (ORCA-1468).
describe('releasing a remote member whose terminal and worktree are gone on its host', () => {
  let homeDb: OrchestrationDb
  let workerDb: OrchestrationDb
  let homeRuntime: OrcaRuntimeService
  let workerRuntime: OrcaRuntimeService
  let homeDispatcher: RpcDispatcher
  let hostDown: boolean

  beforeEach(() => {
    homeDb = new OrchestrationDb(':memory:')
    workerDb = new OrchestrationDb(':memory:')
    workerRuntime = new OrcaRuntimeService()
    workerRuntime.setOrchestrationDb(workerDb)
    configureWorkerRuntime(workerRuntime)
    vi.spyOn(workerRuntime, 'removeManagedWorktree').mockResolvedValue({} as never)
    const workerDispatcher = new RpcDispatcher({
      runtime: workerRuntime,
      methods: [...ORCHESTRATION_METHODS, ...WORKTREE_METHODS]
    })
    hostDown = false
    const transport: OrchestrationEnvironmentTransport = {
      resolve: () => ({
        environmentId: 'environment_koombea',
        name: 'koombea',
        peerFingerprint: 'koombea_peer_fingerprint'
      }),
      call: async (_selector, method, params, _timeoutMs, envelope) => {
        if (hostDown) {
          throw new Error('The Orca Lab runtime closed the connection before responding.')
        }
        if (method === 'status.get') {
          return {
            id: 'status',
            ok: true,
            result: workerRuntime.getStatus(),
            _meta: { runtimeId: workerRuntime.getRuntimeId() }
          }
        }
        return (await workerDispatcher.dispatch({
          id: `remote_${method}`,
          authToken: 'run-home-device-token',
          method,
          params,
          orchestrationContractVersion: envelope?.orchestrationContractVersion,
          orchestrationRequestId: envelope?.orchestrationRequestId,
          orchestrationCapability: envelope?.orchestrationCapability
        })) as RuntimeRpcResponse<unknown>
      }
    }
    homeRuntime = new OrcaRuntimeService(null, undefined, {
      orchestrationEnvironmentTransport: transport
    })
    homeRuntime.setOrchestrationDb(homeDb)
    homeDispatcher = new RpcDispatcher({ runtime: homeRuntime, methods: ORCHESTRATION_METHODS })
    vi.spyOn(homeRuntime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_coord' ? 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : null
    )
  })

  afterEach(() => {
    homeRuntime.stopOrchestrationFederationRelay()
    homeDb.close()
    workerDb.close()
    vi.restoreAllMocks()
  })

  async function startRemoteMember() {
    const run = homeDb.createRun({
      objective: 'Lead',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const task = homeDb.createTask({ spec: 'Remote work', runId: run.id })
    await homeDispatcher.dispatch(startRequest(task.id))
    homeRuntime.stopOrchestrationFederationRelay()
    return { run, dispatch: homeDb.getDispatchContext(task.id)! }
  }

  /** The host restarted without the member's pane, and its worktree was removed there. */
  function memberGoneOnHost(options: { worktree: boolean }) {
    vi.mocked(workerRuntime.showTerminal).mockRejectedValue(new Error('terminal_handle_stale'))
    vi.spyOn(workerRuntime, 'sleepingTerminalHandleOfPane').mockReturnValue(null)
    vi.spyOn(workerRuntime, 'showManagedWorktree').mockImplementation(async () => {
      if (options.worktree) {
        return { id: 'repo::windows-worktree' } as never
      }
      throw new Error('selector_not_found')
    })
  }

  function call(method: string, dispatchId: string, requestId: string) {
    return homeDispatcher.dispatch({
      id: `rpc_${requestId}`,
      authToken: 'coordinator-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: requestId,
      method,
      params: { dispatch: dispatchId }
    })
  }

  it('frees a member whose stop was sent while its host was away, once the host shows nothing of it', async () => {
    const { run, dispatch } = await startRemoteMember()
    hostDown = true
    await call('orchestration.workerStop', dispatch.id, 'stop_away')
    expect(homeDb.getWorkerDispatch(dispatch.id)?.state).toBe('stop_unknown')
    hostDown = false
    memberGoneOnHost({ worktree: false })

    const released = await call('orchestration.workerRelease', dispatch.id, 'release')

    expect(released).toMatchObject({ ok: true, result: { state: 'released' } })
    expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
  })

  it('keeps a member while its worktree is still there, then frees it once the worktree is removed', async () => {
    const { run, dispatch } = await startRemoteMember()
    memberGoneOnHost({ worktree: true })
    await call('orchestration.workerStop', dispatch.id, 'stop_back')
    const first = await call('orchestration.workerRelease', dispatch.id, 'release_1')
    expect(first).toMatchObject({ ok: true, result: { state: 'retained' } })
    memberGoneOnHost({ worktree: false })

    const released = await call('orchestration.workerRelease', dispatch.id, 'release_2')

    expect(released).toMatchObject({ ok: true, result: { state: 'released' } })
    expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
  })

  it('stops and frees a member never stopped whose host shows nothing of it', async () => {
    const { run, dispatch } = await startRemoteMember()
    memberGoneOnHost({ worktree: false })

    await call('orchestration.workerStop', dispatch.id, 'stop')
    const released = await call('orchestration.workerRelease', dispatch.id, 'release')

    expect(released).toMatchObject({ ok: true, result: { state: 'released' } })
    expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
  })
})
