import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ORCHESTRATION_CONTRACT_VERSION,
  ORCHESTRATION_FEDERATION_DETACH_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import type { OrchestrationEnvironmentTransport } from '../../orchestration/environment-transport'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATION_METHODS } from './orchestration'
import { createFederationWorkerStartRequest as startRequest } from './orchestration-federation-test-request'
import { configureWorkerRuntime } from './orchestration-federation-worker-runtime-mocks'
import { WORKTREE_METHODS } from './worktree'

// Why: `game drop` on a live member on a paired host refused, so the lead could not let it go (ORCA-1326).
describe('detaching a live remote member through its host', () => {
  let homeDb: OrchestrationDb
  let workerDb: OrchestrationDb
  let homeRuntime: OrcaRuntimeService
  let workerRuntime: OrcaRuntimeService
  let homeDispatcher: RpcDispatcher
  let workerCapabilities: string[]
  let remoteMethods: string[]
  let onHostCall: (method: string, answer: () => Promise<unknown>) => Promise<unknown>

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
    onHostCall = (_method, answer) => answer()
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
            result: {
              ...workerRuntime.getStatus(),
              appVersion: '1.4.150-lab.110',
              capabilities: workerCapabilities
            },
            _meta: { runtimeId: workerRuntime.getRuntimeId() }
          }
        }
        return (await onHostCall(method, () =>
          workerDispatcher.dispatch({
            id: `remote_${method}`,
            authToken: 'run-home-device-token',
            method,
            params,
            orchestrationContractVersion: envelope?.orchestrationContractVersion,
            orchestrationRequestId: envelope?.orchestrationRequestId,
            orchestrationCapability: envelope?.orchestrationCapability
          })
        )) as RuntimeRpcResponse<unknown>
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

  async function startLiveRemoteMember(): Promise<string> {
    const run = homeDb.createRun({
      objective: 'Remote members',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const task = homeDb.createTask({ spec: 'Remote work', runId: run.id })
    await homeDispatcher.dispatch(startRequest(task.id))
    homeRuntime.stopOrchestrationFederationRelay()
    const dispatchId = homeDb.getDispatchContext(task.id)!.id
    expect(homeDb.getWorkerDispatch(dispatchId)?.state).toBe('ready')
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)?.state).toBe('ready')
    return dispatchId
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

  it('detaches on a capable host, and a later release keeps its terminal and worktree', async () => {
    const dispatchId = await startLiveRemoteMember()

    const response = await call('orchestration.workerDetach', dispatchId, 'detach_request')

    expect(response).toMatchObject({
      ok: true,
      result: { dispatchId, state: 'stopped', alreadySettled: false, processAction: 'none' }
    })
    expect(remoteMethods).toContain('orchestration.federationDetach')
    expect(homeDb.getWorkerDispatch(dispatchId)).toMatchObject({
      state: 'stopped',
      stage: 'detached'
    })
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)).toMatchObject({
      state: 'stopped',
      stage: 'detached',
      capability_hash: null
    })

    const released = await call('orchestration.workerRelease', dispatchId, 'release_request')

    expect(released).toMatchObject({ ok: true, result: { state: 'retained' } })
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
    expect(workerRuntime.removeManagedWorktree).not.toHaveBeenCalled()
  })

  it('refuses on an older host, naming it and its version, and changes nothing on either side', async () => {
    workerCapabilities = workerCapabilities.filter(
      (capability) => capability !== ORCHESTRATION_FEDERATION_DETACH_RUNTIME_CAPABILITY
    )
    const dispatchId = await startLiveRemoteMember()

    const response = await call('orchestration.workerDetach', dispatchId, 'detach_request')

    expect(response).toMatchObject({ ok: false, error: { code: 'capability_unsupported' } })
    expect(JSON.stringify(response)).toContain('windows runs Orca 1.4.150-lab.110')
    expect(remoteMethods).not.toContain('orchestration.federationDetach')
    expect(homeDb.getWorkerDispatch(dispatchId)?.state).toBe('ready')
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)?.state).toBe('ready')
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
  })

  it('keeps the member live at home when the host drops the connection mid-detach, and a retry settles it', async () => {
    const dispatchId = await startLiveRemoteMember()
    // Why after the answer: the host detached it, but the home never heard so.
    onHostCall = async (method, answer) => {
      const result = await answer()
      if (method === 'orchestration.federationDetach') {
        throw new Error('connection closed')
      }
      return result
    }

    const lost = await call('orchestration.workerDetach', dispatchId, 'detach_request')

    expect(lost).toMatchObject({ ok: false })
    expect(homeDb.getWorkerDispatch(dispatchId)?.state).toBe('ready')

    onHostCall = (_method, answer) => answer()
    const retried = await call('orchestration.workerDetach', dispatchId, 'detach_retry')

    expect(retried).toMatchObject({ ok: true, result: { state: 'stopped' } })
    expect(homeDb.getWorkerDispatch(dispatchId)?.stage).toBe('detached')
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
  })

  it('never detaches at home on a host answer that is not a detach', async () => {
    const dispatchId = await startLiveRemoteMember()
    onHostCall = async (method, answer) =>
      method === 'orchestration.federationDetach'
        ? { id: 'remote', ok: true, result: { dispatchId, state: 'succeeded', stage: 'done' } }
        : answer()

    const response = await call('orchestration.workerDetach', dispatchId, 'detach_request')

    expect(response).toMatchObject({ ok: false, error: { code: 'dispatch_inactive' } })
    expect(homeDb.getWorkerDispatch(dispatchId)?.state).toBe('ready')
  })
})
