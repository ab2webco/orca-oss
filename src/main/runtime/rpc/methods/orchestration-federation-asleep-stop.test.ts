import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ORCHESTRATION_CONTRACT_VERSION,
  ORCHESTRATION_FEDERATION_STOP_ASLEEP_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
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

// Why: an earlier lead's remote member slept on its host after a restart; its stop said
// 'process is asleep', a second stop was refused from stop_unknown, and it held a slot (ORCA-1433).
describe('stopping a remote member whose pane is asleep on its host', () => {
  let homeDb: OrchestrationDb
  let workerDb: OrchestrationDb
  let homeRuntime: OrcaRuntimeService
  let workerRuntime: OrcaRuntimeService
  let homeDispatcher: RpcDispatcher
  let workerCapabilities: string[]
  let remoteMethods: string[]

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
    workerCapabilities = [...(workerRuntime.getStatus().capabilities ?? [])]
    remoteMethods = []
    const transport: OrchestrationEnvironmentTransport = {
      resolve: () => ({
        environmentId: 'environment_windows',
        name: 'windows',
        peerFingerprint: 'windows_peer_fingerprint'
      }),
      call: async (_selector, method, params, _timeoutMs, envelope) => {
        remoteMethods.push(method)
        if (method === 'status.get') {
          return {
            id: 'status',
            ok: true,
            result: { ...workerRuntime.getStatus(), capabilities: workerCapabilities },
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

  async function startAsleepRemoteMember() {
    const run = homeDb.createRun({
      objective: 'Earlier lead',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const task = homeDb.createTask({ spec: 'Remote work', runId: run.id })
    await homeDispatcher.dispatch(startRequest(task.id))
    homeRuntime.stopOrchestrationFederationRelay()
    // The host restarted: the recorded handle is stale and the pane is listed asleep.
    vi.mocked(workerRuntime.showTerminal).mockRejectedValue(new Error('terminal_handle_stale'))
    vi.spyOn(workerRuntime, 'sleepingTerminalHandleOfPane').mockReturnValue('term_windows_asleep')
    return { run, dispatch: homeDb.getDispatchContext(task.id)! }
  }

  /** The state an older host left: its stop could not close the asleep pane. */
  async function leaveStopUnknown(dispatchId: string) {
    vi.mocked(workerRuntime.closeTerminal).mockRejectedValueOnce(new Error('terminal_handle_stale'))
    await expect(stop(dispatchId, 'first_stop')).resolves.toMatchObject({
      ok: true,
      result: { state: 'stop_unknown' }
    })
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)?.state).toBe('stop_unknown')
    vi.mocked(workerRuntime.closeTerminal).mockClear()
    remoteMethods = []
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
  const stop = (dispatchId: string, requestId = 'stop') =>
    call('orchestration.workerStop', dispatchId, requestId)
  const release = (dispatchId: string, requestId = 'release') =>
    call('orchestration.workerRelease', dispatchId, requestId)

  it('closes the asleep pane on the host and settles the stop', async () => {
    const { dispatch } = await startAsleepRemoteMember()

    const stopped = await stop(dispatch.id)

    expect(stopped).toMatchObject({
      ok: true,
      result: { state: 'stopped', processAction: 'closed_agent_terminal' }
    })
    expect(workerRuntime.closeTerminal).toHaveBeenCalledWith('term_windows_asleep')
    expect(workerDb.getRemoteDispatchAttachment(dispatch.id)?.state).toBe('stopped')
  })

  it('retries a stop from stop_unknown on a host that can', async () => {
    const { dispatch } = await startAsleepRemoteMember()
    await leaveStopUnknown(dispatch.id)

    const stopped = await stop(dispatch.id, 'second_stop')

    expect(stopped).toMatchObject({ ok: true, result: { state: 'stopped' } })
    expect(workerRuntime.closeTerminal).toHaveBeenCalledWith('term_windows_asleep')
    expect(homeDb.getWorkerDispatch(dispatch.id)?.state).toBe('stopped')
  })

  it('frees a stop_unknown member with one release and drops it from the fleet', async () => {
    const { run, dispatch } = await startAsleepRemoteMember()
    await leaveStopUnknown(dispatch.id)

    const released = await release(dispatch.id)

    expect(released).toMatchObject({ ok: true, result: { state: 'released' } })
    expect(workerRuntime.closeTerminal).toHaveBeenCalledWith('term_windows_asleep')
    expect(workerDb.getRemoteDispatchAttachment(dispatch.id)?.stage).toBe('released')
    expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
  })

  it('refuses a retried stop by name on an older host and changes nothing', async () => {
    const { dispatch } = await startAsleepRemoteMember()
    await leaveStopUnknown(dispatch.id)
    workerCapabilities = workerCapabilities.filter(
      (capability) => capability !== ORCHESTRATION_FEDERATION_STOP_ASLEEP_RUNTIME_CAPABILITY
    )

    const stopped = await stop(dispatch.id, 'old_host_stop')
    const released = await release(dispatch.id, 'old_host_release')

    expect(stopped).toMatchObject({ ok: false, error: { code: 'capability_unsupported' } })
    expect(JSON.stringify(stopped)).toContain('update Orca on windows')
    expect(released).toMatchObject({
      ok: true,
      result: { state: 'retained', reason: 'not_settled' }
    })
    expect(remoteMethods).not.toContain('orchestration.federationStop')
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
    expect(homeDb.getWorkerDispatch(dispatch.id)?.state).toBe('stop_unknown')
  })
})
