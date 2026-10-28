import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ORCHESTRATION_CONTRACT_VERSION,
  ORCHESTRATION_FEDERATION_RELEASE_RUNTIME_CAPABILITY
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

// Why: a finished remote member could not be released, so it stayed in the fleet and its
// terminal and worktree stayed on the remote host (ORCA-790).
describe('releasing a remote worker through the relay', () => {
  let homeDb: OrchestrationDb
  let workerDb: OrchestrationDb
  let homeRuntime: OrcaRuntimeService
  let workerRuntime: OrcaRuntimeService
  let homeDispatcher: RpcDispatcher
  let workerDispatcher: RpcDispatcher
  let workerCapabilities: string[]
  let remoteMethods: string[]

  beforeEach(() => {
    homeDb = new OrchestrationDb(':memory:')
    workerDb = new OrchestrationDb(':memory:')
    workerRuntime = new OrcaRuntimeService()
    workerRuntime.setOrchestrationDb(workerDb)
    configureWorkerRuntime(workerRuntime)
    vi.spyOn(workerRuntime, 'removeManagedWorktree').mockResolvedValue({} as never)
    workerDispatcher = new RpcDispatcher({ runtime: workerRuntime, methods: ORCHESTRATION_METHODS })
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

  async function startRemoteMember() {
    const run = homeDb.createRun({
      objective: 'Remote members',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const task = homeDb.createTask({ spec: 'Remote work', runId: run.id })
    await homeDispatcher.dispatch(startRequest(task.id))
    homeRuntime.stopOrchestrationFederationRelay()
    return { run, task, dispatch: homeDb.getDispatchContext(task.id)! }
  }

  async function finishRemoteMember(taskId: string, dispatchId: string): Promise<void> {
    const prompt = vi.mocked(workerRuntime.sendTerminalAgentPrompt).mock.calls[0]?.[1] ?? ''
    const sent = workerDispatcher.dispatch({
      id: 'rpc_worker_done',
      authToken: 'worker-local-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: 'worker_done_request',
      orchestrationCapability: prompt.match(/--dispatch-capability (dcap_[A-Za-z0-9_-]+)/)?.[1],
      method: 'orchestration.send',
      params: {
        from: 'term_windows_worker',
        subject: 'Done',
        type: 'worker_done',
        payload: JSON.stringify({ taskId, dispatchId, outcome: 'succeeded' })
      }
    })
    await vi.waitFor(() =>
      expect(workerDb.listPendingFederationRelay(dispatchId, 'to_home')).toHaveLength(1)
    )
    await homeRuntime.syncOrchestrationFederation()
    await sent
    expect(homeDb.getWorkerDispatch(dispatchId)?.state).toBe('succeeded')
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)?.state).toBe('succeeded')
  }

  function release(dispatchId: string, requestId = 'release_request') {
    return homeDispatcher.dispatch({
      id: `rpc_${requestId}`,
      authToken: 'coordinator-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: requestId,
      method: 'orchestration.workerRelease',
      params: { dispatch: dispatchId }
    })
  }

  it('closes the remote terminal, removes its worktree and drops it from the fleet', async () => {
    const { run, task, dispatch } = await startRemoteMember()
    await finishRemoteMember(task.id, dispatch.id)

    const response = await release(dispatch.id)

    expect(response).toMatchObject({
      ok: true,
      result: {
        dispatchId: dispatch.id,
        state: 'released',
        processAction: 'closed_agent_terminal',
        remote: {
          closedTerminals: ['term_windows_worker'],
          removedWorktree: 'repo::windows-worktree'
        }
      }
    })
    expect(workerRuntime.closeTerminal).toHaveBeenCalledWith('term_windows_worker')
    // Why not force: a dirty remote tree must survive; the branch is kept either way.
    expect(workerRuntime.removeManagedWorktree).toHaveBeenCalledWith(
      'id:repo::windows-worktree',
      false
    )
    expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
  })

  it('answers already_released on a repeat without touching the host again', async () => {
    const { task, dispatch } = await startRemoteMember()
    await finishRemoteMember(task.id, dispatch.id)
    await release(dispatch.id)
    vi.mocked(workerRuntime.closeTerminal).mockClear()

    const response = await release(dispatch.id, 'release_again')

    expect(response).toMatchObject({ ok: true, result: { state: 'already_released' } })
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
  })

  it('keeps the member when its worktree has changes, and says so', async () => {
    vi.mocked(workerRuntime.removeManagedWorktree).mockRejectedValue(
      new Error('worktree contains modified or untracked files')
    )
    const { run, task, dispatch } = await startRemoteMember()
    await finishRemoteMember(task.id, dispatch.id)

    const response = await release(dispatch.id)

    expect(response).toMatchObject({
      ok: true,
      result: {
        state: 'released',
        remote: {
          removedWorktree: null,
          worktreeError: 'worktree contains modified or untracked files'
        }
      }
    })
    expect(listRemoteGameMemberSources(homeDb, run.id)).toEqual([])
  })

  it('retains a remote member that has not finished, closing nothing', async () => {
    const { dispatch } = await startRemoteMember()

    const response = await release(dispatch.id)

    expect(response).toMatchObject({
      ok: true,
      result: { state: 'retained', reason: 'not_settled' }
    })
    expect(remoteMethods).not.toContain('orchestration.federationRelease')
    expect(workerRuntime.closeTerminal).not.toHaveBeenCalled()
  })

  it('retains on an older host without the release capability and calls nothing there', async () => {
    workerCapabilities = workerCapabilities.filter(
      (capability) => capability !== ORCHESTRATION_FEDERATION_RELEASE_RUNTIME_CAPABILITY
    )
    const { task, dispatch } = await startRemoteMember()
    await finishRemoteMember(task.id, dispatch.id)

    const response = await release(dispatch.id)

    expect(response).toMatchObject({
      ok: true,
      result: { state: 'retained', reason: 'federation_unsupported' }
    })
    expect(JSON.stringify(response)).toContain('update Orca on windows')
    expect(remoteMethods).not.toContain('orchestration.federationRelease')
  })
})
