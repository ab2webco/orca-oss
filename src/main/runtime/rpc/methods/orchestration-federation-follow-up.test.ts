import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import {
  ORCHESTRATION_CONTRACT_VERSION,
  ORCHESTRATION_FEDERATION_FOLLOW_UP_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import type { OrchestrationEnvironmentTransport } from '../../orchestration/environment-transport'
import { SUCCESS_ENVELOPE } from '../../orchestration/worker-done-envelope-fixture'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATION_METHODS } from './orchestration'
import { createFederationWorkerStartRequest as startRequest } from './orchestration-federation-test-request'
import { configureWorkerRuntime } from './orchestration-federation-worker-runtime-mocks'

const WORKER_PANE = 'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

// ORCA-838: the lead gives a settled remote member tracked follow-up work on its existing agent.
describe('lead follow-up on a settled remote member', () => {
  let homeDb: OrchestrationDb
  let workerDb: OrchestrationDb
  let homeRuntime: OrcaRuntimeService
  let workerRuntime: OrcaRuntimeService
  let homeDispatcher: RpcDispatcher
  let workerDispatcher: RpcDispatcher
  let workerCapabilities: string[]
  let requests = 0

  beforeEach(() => {
    homeDb = new OrchestrationDb(':memory:')
    workerDb = new OrchestrationDb(':memory:')
    workerRuntime = new OrcaRuntimeService()
    workerRuntime.setOrchestrationDb(workerDb)
    workerDispatcher = new RpcDispatcher({ runtime: workerRuntime, methods: ORCHESTRATION_METHODS })
    workerCapabilities = [...(workerRuntime.getStatus().capabilities ?? [])]
    const transport: OrchestrationEnvironmentTransport = {
      resolve: () => ({
        environmentId: 'environment_windows',
        name: 'windows',
        peerFingerprint: 'windows_peer_fingerprint'
      }),
      call: async (_selector, method, params, _timeoutMs, envelope) => {
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
    configureWorkerRuntime(workerRuntime)
  })

  afterEach(() => {
    homeRuntime.stopOrchestrationFederationRelay()
    homeDb.close()
    workerDb.close()
  })

  function workerCall(method: string, params: Record<string, unknown>, capability?: string) {
    requests += 1
    return workerDispatcher.dispatch({
      id: `rpc_member_${requests}`,
      authToken: 'worker-local-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: `member_request_${requests}`,
      orchestrationCapability: capability,
      method,
      params: { from: 'term_windows_worker', ...params }
    }) as Promise<RuntimeRpcResponse<unknown>>
  }

  function leadSend(dispatchId: string, params: Record<string, unknown> = {}) {
    requests += 1
    return homeDispatcher.dispatch({
      id: `rpc_lead_${requests}`,
      authToken: 'coordinator-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: `lead_request_${requests}`,
      method: 'orchestration.send',
      params: {
        from: 'term_coord',
        to: `dispatch:${dispatchId}`,
        subject: 'Follow-up',
        body: 'Also cover the Linux path.',
        type: 'status',
        ...params
      }
    }) as Promise<RuntimeRpcResponse<unknown>>
  }

  async function reportDone(taskId: string, dispatchId: string, capability: string) {
    const sent = workerCall(
      'orchestration.send',
      {
        subject: 'Done',
        body: 'Finished the audit.',
        type: 'worker_done',
        payload: JSON.stringify({
          taskId,
          dispatchId,
          outcome: 'succeeded',
          envelope: SUCCESS_ENVELOPE
        })
      },
      capability
    )
    await vi.waitFor(() =>
      expect(workerDb.listPendingFederationRelay(dispatchId, 'to_home')).toHaveLength(1)
    )
    await homeRuntime.syncOrchestrationFederatedDispatch(dispatchId)
    return sent
  }

  async function settledMember() {
    const run = homeDb.createRun({
      objective: 'Mac to Windows',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const task = homeDb.createTask({ spec: 'Audit Windows behavior', runId: run.id })
    expect(await homeDispatcher.dispatch(startRequest(task.id))).toMatchObject({ ok: true })
    homeRuntime.stopOrchestrationFederationRelay()
    const dispatchId = homeDb.getDispatchContext(task.id)!.id
    const prompt = vi.mocked(workerRuntime.sendTerminalAgentPrompt).mock.calls[0]?.[1] ?? ''
    const capability = prompt.match(/--dispatch-capability (dcap_[A-Za-z0-9_-]+)/)?.[1] as string
    await expect(reportDone(task.id, dispatchId, capability)).resolves.toMatchObject({
      ok: true,
      result: { lifecycle: { action: 'completed' } }
    })
    expect(homeDb.getDispatchContextById(dispatchId)?.status).toBe('completed')
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)?.state).toBe('succeeded')
    return { runId: run.id, taskId: task.id, dispatchId, capability }
  }

  function withoutFollowUp(): void {
    workerCapabilities = workerCapabilities.filter(
      (capability) => capability !== ORCHESTRATION_FEDERATION_FOLLOW_UP_RUNTIME_CAPABILITY
    )
  }

  it('negotiates protocol 5 only with a host that advertises follow-ups', async () => {
    const { dispatchId } = await settledMember()
    expect(homeDb.getFederatedDispatch(dispatchId)?.protocol_version).toBe(5)
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)?.protocol_version).toBe(5)
  })

  it('reopens both sides and queues the follow-up for the member pane', async () => {
    const { taskId, dispatchId } = await settledMember()

    await expect(leadSend(dispatchId)).resolves.toMatchObject({
      ok: true,
      result: { relay: { dispatchId, accepted: true }, reopenedDispatchId: dispatchId }
    })
    expect(homeDb.getDispatchContextById(dispatchId)?.status).toBe('dispatched')
    expect(homeDb.getTask(taskId)?.status).toBe('dispatched')
    expect(homeDb.getWorkerDispatch(dispatchId)).toMatchObject({
      state: 'ready',
      stage: 'renewed_for_follow_up'
    })

    await homeRuntime.syncOrchestrationFederatedDispatch(dispatchId)

    expect(workerDb.getRemoteDispatchAttachment(dispatchId)).toMatchObject({
      state: 'ready',
      stage: 'reopened_by_lead_follow_up'
    })
    // Why: push-on-idle delivers through the pane's active attachment, so a busy agent gets it next turn.
    expect(workerDb.findActiveRemoteAttachmentForPane(WORKER_PANE)?.dispatch_id).toBe(dispatchId)
    expect(
      workerDb.isRemoteAttachmentProcessCurrent({
        dispatchId,
        paneKey: WORKER_PANE,
        processIncarnation: 'windows_runtime:pty:1'
      })
    ).toBe(true)
    const [mail] = workerDb.getUnreadMessages(`dispatch:${dispatchId}`)
    expect(mail).toMatchObject({ subject: 'Follow-up', from_handle: 'term_coord' })
    expect(mail.body).toContain('Also cover the Linux path.')
    expect(mail.body).toContain(`--task-id ${taskId} --dispatch-id ${dispatchId}`)
  })

  it('settles both sides again on the next worker_done', async () => {
    const { taskId, dispatchId, capability } = await settledMember()
    await expect(leadSend(dispatchId)).resolves.toMatchObject({ ok: true })
    await homeRuntime.syncOrchestrationFederatedDispatch(dispatchId)
    homeRuntime.stopOrchestrationFederationRelay()

    await expect(reportDone(taskId, dispatchId, capability)).resolves.toMatchObject({
      ok: true,
      result: { lifecycle: { action: 'completed' } }
    })
    expect(homeDb.getDispatchContextById(dispatchId)?.status).toBe('completed')
    expect(homeDb.getWorkerDispatch(dispatchId)?.state).toBe('succeeded')
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)?.state).toBe('succeeded')
  })

  it('names the next step for a host without follow-ups and changes nothing', async () => {
    withoutFollowUp()
    const { dispatchId } = await settledMember()

    await expect(leadSend(dispatchId)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'dispatch_inactive',
        message: expect.stringContaining('worker-start --on windows')
      }
    })
    expect(homeDb.getDispatchContextById(dispatchId)?.status).toBe('completed')
    expect(homeDb.listPendingFederationRelay(dispatchId, 'to_worker')).toHaveLength(0)
  })

  it('refuses a released member with its next step and changes nothing', async () => {
    const { dispatchId } = await settledMember()
    homeDb.markFederatedWorkerReleased(dispatchId)

    await expect(leadSend(dispatchId)).resolves.toMatchObject({
      ok: false,
      error: { code: 'dispatch_inactive', message: expect.stringContaining('released') }
    })
    expect(homeDb.getDispatchContextById(dispatchId)?.status).toBe('completed')
    expect(homeDb.listPendingFederationRelay(dispatchId, 'to_worker')).toHaveLength(0)
  })

  it('points a busy-agent worker-start on that terminal to the follow-up', async () => {
    const { runId, dispatchId } = await settledMember()
    vi.spyOn(workerRuntime, 'showManagedTerminalWorkspace').mockResolvedValue({
      id: 'repo::windows-worktree'
    } as never)
    vi.mocked(workerRuntime.waitForTerminal).mockResolvedValue({
      handle: 'term_windows_worker',
      condition: 'tui-idle',
      satisfied: false,
      status: 'running',
      exitCode: null
    })
    const next = homeDb.createTask({ spec: 'More Windows work', runId })

    const started = await homeDispatcher.dispatch({
      ...startRequest(next.id, {
        worktree: 'id:repo::windows-worktree',
        terminal: 'term_windows_worker',
        repo: undefined,
        name: undefined,
        agent: undefined
      }),
      orchestrationRequestId: 'request_windows_follow_up'
    })

    expect(started).toMatchObject({
      ok: true,
      result: { failedStage: 'agent_readiness' }
    })
    const lastError = (started as { result: { lastError: string } }).result.lastError
    expect(lastError).toContain(`orca orchestration send --to dispatch:${dispatchId}`)
  })
})
