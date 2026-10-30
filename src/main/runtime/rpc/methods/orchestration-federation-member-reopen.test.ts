import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import {
  ORCHESTRATION_CONTRACT_VERSION,
  ORCHESTRATION_FEDERATION_FOLLOW_UP_RUNTIME_CAPABILITY,
  ORCHESTRATION_FEDERATION_MEMBER_REOPEN_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import type { OrchestrationEnvironmentTransport } from '../../orchestration/environment-transport'
import { SUCCESS_ENVELOPE } from '../../orchestration/worker-done-envelope-fixture'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATION_METHODS } from './orchestration'
import { createFederationWorkerStartRequest as startRequest } from './orchestration-federation-test-request'
import { configureWorkerRuntime } from './orchestration-federation-worker-runtime-mocks'

// ORCA-856: a member on a paired host still reaches its lead with `ask` after worker_done.
describe('federated member ask after worker_done', () => {
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
    vi.useRealTimers()
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

  function withoutMemberReopen(): void {
    workerCapabilities = workerCapabilities.filter(
      (capability) => capability !== ORCHESTRATION_FEDERATION_MEMBER_REOPEN_RUNTIME_CAPABILITY
    )
  }

  it('negotiates protocol 4 only with a host that advertises member reopen', async () => {
    workerCapabilities = workerCapabilities.filter(
      (capability) => capability !== ORCHESTRATION_FEDERATION_FOLLOW_UP_RUNTIME_CAPABILITY
    )
    const current = await settledMember()
    expect(workerDb.getRemoteDispatchAttachment(current.dispatchId)?.protocol_version).toBe(4)
    expect(homeDb.getFederatedDispatch(current.dispatchId)?.protocol_version).toBe(4)
  })

  it('keeps protocol 3 for a host without member reopen', async () => {
    withoutMemberReopen()
    const { dispatchId } = await settledMember()
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)?.protocol_version).toBe(3)
    expect(homeDb.getFederatedDispatch(dispatchId)?.protocol_version).toBe(3)
  })

  it("reaches the lead's pending questions and returns the lead's answer", async () => {
    const { runId, dispatchId, capability } = await settledMember()

    const ask = workerCall(
      'orchestration.ask',
      { question: 'The owner added work: may I extend the PR?', timeoutMs: 60_000 },
      capability
    )
    await vi.waitFor(() =>
      expect(workerDb.listPendingFederationRelay(dispatchId, 'to_home')).toHaveLength(1)
    )
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)).toMatchObject({
      state: 'ready',
      stage: 'reopened_by_member_ask'
    })

    homeRuntime.syncOrchestrationFederationReopenWatch()
    await vi.waitFor(() => expect(homeDb.listPendingQuestions(runId)).toHaveLength(1))
    const question = homeDb.listPendingQuestions(runId)[0]
    expect(question.body).toBe('The owner added work: may I extend the PR?')
    expect(homeDb.getDispatchContextById(dispatchId)?.status).toBe('dispatched')
    expect(homeDb.getWorkerDispatch(dispatchId)?.state).toBe('ready')
    expect(homeDb.isFederatedDispatchRelayEligible(dispatchId)).toBe(true)

    const reply = await homeDispatcher.dispatch({
      id: 'rpc_home_reply',
      authToken: 'coordinator-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: 'home_reply_request',
      method: 'orchestration.reply',
      params: { id: question.id, body: 'yes, extend it', from: 'term_coord' }
    })
    expect(reply).toMatchObject({ ok: true })
    await homeRuntime.syncOrchestrationFederatedDispatch(dispatchId)

    await expect(ask).resolves.toMatchObject({
      ok: true,
      result: {
        answer: 'yes, extend it',
        messageId: question.id,
        reopenedDispatchId: dispatchId,
        timedOut: false
      }
    })
  })

  it('settles both sides again on the next worker_done', async () => {
    const { runId, taskId, dispatchId, capability } = await settledMember()
    const ask = workerCall('orchestration.ask', { question: 'Proceed?', timeoutMs: 1 }, capability)
    await expect(ask).resolves.toMatchObject({ ok: true, result: { timedOut: true } })
    homeRuntime.syncOrchestrationFederationReopenWatch()
    await vi.waitFor(() => expect(homeDb.listPendingQuestions(runId)).toHaveLength(1))
    homeRuntime.stopOrchestrationFederationRelay()

    await expect(reportDone(taskId, dispatchId, capability)).resolves.toMatchObject({
      ok: true,
      result: { lifecycle: { action: 'completed', authority: 'run_home' } }
    })
    expect(homeDb.getDispatchContextById(dispatchId)?.status).toBe('completed')
    expect(homeDb.getTask(taskId)?.status).toBe('completed')
    expect(homeDb.getWorkerDispatch(dispatchId)?.state).toBe('succeeded')
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)).toMatchObject({
      state: 'succeeded',
      capability_hash: null
    })
  })

  it('names the next step when the lead cannot reopen, and enqueues nothing', async () => {
    withoutMemberReopen()
    const { dispatchId, capability } = await settledMember()

    const refused = await workerCall(
      'orchestration.ask',
      { question: 'Proceed?', timeoutMs: 1 },
      capability
    )

    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: 'dispatch_reopen_unsupported',
        message: expect.stringContaining('ask the lead for a follow-up dispatch')
      }
    })
    expect(workerDb.listPendingFederationRelay(dispatchId, 'to_home')).toHaveLength(0)
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)?.state).toBe('succeeded')
  })

  it.each([
    ['a wrong capability', () => 'dcap_someone_else'],
    [
      'a released member',
      (dispatchId: string, capability: string) => {
        workerDb.markRemoteAttachmentReleased(dispatchId)
        return capability
      }
    ]
  ] as const)('stays dispatch_inactive for %s', async (_label, prepare) => {
    const { dispatchId, capability } = await settledMember()

    const refused = await workerCall(
      'orchestration.ask',
      { question: 'Proceed?', timeoutMs: 1 },
      prepare(dispatchId, capability)
    )

    expect(refused).toMatchObject({ ok: false, error: { code: 'dispatch_inactive' } })
    expect(workerDb.listPendingFederationRelay(dispatchId, 'to_home')).toHaveLength(0)
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)).toMatchObject({
      state: 'succeeded',
      capability_hash: null
    })
  })

  it('watches settled reopenable members on a slow timer, not released ones', async () => {
    const { dispatchId } = await settledMember()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const sync = vi
      .spyOn(homeRuntime, 'syncOrchestrationFederatedDispatch')
      .mockResolvedValue(undefined)

    homeRuntime.ensureOrchestrationFederationRelay()
    vi.advanceTimersByTime(10_000)
    expect(sync).toHaveBeenCalledWith(dispatchId)

    sync.mockClear()
    homeDb.markFederatedWorkerReleased(dispatchId)
    vi.advanceTimersByTime(10_000)
    expect(sync).not.toHaveBeenCalled()
  })
})
