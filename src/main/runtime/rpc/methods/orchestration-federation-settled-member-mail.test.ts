import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import {
  ORCHESTRATION_CONTRACT_VERSION,
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

const RUN_HOME = 'Run home (relayed by Orca Lab)'

type Member = { runId: string; taskId: string; dispatchId: string; capability: string }

// ORCA-1345: a remote member's report after its worker_done reached a handle nobody reads.
describe('remote member mail to its Run home after worker_done', () => {
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

  function homeCall(method: string, params: Record<string, unknown>) {
    requests += 1
    return homeDispatcher.dispatch({
      id: `rpc_lead_${requests}`,
      authToken: 'coordinator-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: `lead_request_${requests}`,
      method,
      params: { from: 'term_coord', ...params }
    }) as Promise<RuntimeRpcResponse<unknown>>
  }

  function report(capability: string | undefined, params: Record<string, unknown> = {}) {
    return workerCall(
      'orchestration.send',
      {
        to: RUN_HOME,
        type: 'escalation',
        subject: 'report',
        body: 'ORCA-1414: the second fix is pushed at 63b0ff4ad4.',
        ...params
      },
      capability
    )
  }

  async function reportDone(member: Omit<Member, 'runId'>) {
    const pending = workerDb.listPendingFederationRelay(member.dispatchId, 'to_home').length
    const sent = workerCall(
      'orchestration.send',
      {
        subject: 'Done',
        body: 'Finished the audit.',
        type: 'worker_done',
        payload: JSON.stringify({
          taskId: member.taskId,
          dispatchId: member.dispatchId,
          outcome: 'succeeded',
          envelope: SUCCESS_ENVELOPE
        })
      },
      member.capability
    )
    await vi.waitFor(() =>
      expect(workerDb.listPendingFederationRelay(member.dispatchId, 'to_home')).toHaveLength(
        pending + 1
      )
    )
    await homeRuntime.syncOrchestrationFederatedDispatch(member.dispatchId)
    await expect(sent).resolves.toMatchObject({
      ok: true,
      result: { lifecycle: { action: 'completed' } }
    })
  }

  async function settledMember(): Promise<Member> {
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
    expect(prompt).toContain(`Your coordinator's terminal handle is: ${RUN_HOME}`)
    const capability = prompt.match(/--dispatch-capability (dcap_[A-Za-z0-9_-]+)/)?.[1] as string
    const member = { runId: run.id, taskId: task.id, dispatchId, capability }
    await reportDone(member)
    expect(homeDb.getDispatchContextById(dispatchId)?.status).toBe('completed')
    expect(workerDb.getRemoteDispatchAttachment(dispatchId)?.state).toBe('succeeded')
    return member
  }

  /** The escalations the lead's `check --peek --types escalation` on its Run lists after a pull. */
  async function leadInbox(member: Member): Promise<{ from_handle: string; body: string }[]> {
    homeRuntime.syncOrchestrationFederationReopenWatch()
    await vi.waitFor(() =>
      expect(
        homeDb
          .getUnreadMessages(`run:${member.runId}`)
          .some((message) => message.type === 'escalation')
      ).toBe(true)
    )
    const checked = await homeCall('orchestration.check', {
      terminal: 'term_coord',
      run: member.runId,
      peek: true,
      unread: false,
      types: 'escalation'
    })
    expect(checked).toMatchObject({ ok: true })
    return (checked as { result: { messages: { from_handle: string; body: string }[] } }).result
      .messages
  }

  function strandedOnHost(): unknown[] {
    return [...workerDb.getUnreadMessages('Run home'), ...workerDb.getUnreadMessages(RUN_HOME)]
  }

  it.each([
    ['--to the Run home handle the brief prints', {}],
    ['--to "Run home"', { to: 'Run home' }],
    ['no --to', { to: undefined }]
  ])("reaches the lead's inbox with %s", async (_label, params) => {
    const member = await settledMember()

    await expect(report(member.capability, params)).resolves.toMatchObject({
      ok: true,
      result: { relay: { dispatchId: member.dispatchId, destination: 'run_home', accepted: true } }
    })

    expect(strandedOnHost()).toEqual([])
    expect(workerDb.getRemoteDispatchAttachment(member.dispatchId)?.state).toBe('succeeded')
    const inbox = await leadInbox(member)
    expect(inbox).toEqual([
      expect.objectContaining({
        from_handle: `dispatch:${member.dispatchId}`,
        body: 'ORCA-1414: the second fix is pushed at 63b0ff4ad4.'
      })
    ])
    // Why: the report must not reopen work the lead already settled.
    expect(homeDb.getDispatchContextById(member.dispatchId)?.status).toBe('completed')
  })

  it('reaches the lead after a follow-up and a second worker_done, as on m1', async () => {
    const member = await settledMember()
    await expect(
      homeCall('orchestration.send', {
        to: `dispatch:${member.dispatchId}`,
        subject: 'Follow-up',
        body: 'The merge queue dropped #1465; fix it.',
        type: 'status'
      })
    ).resolves.toMatchObject({ ok: true, result: { reopenedDispatchId: member.dispatchId } })
    await homeRuntime.syncOrchestrationFederatedDispatch(member.dispatchId)
    homeRuntime.stopOrchestrationFederationRelay()
    await reportDone(member)
    expect(workerDb.getRemoteDispatchAttachment(member.dispatchId)?.state).toBe('succeeded')

    await expect(report(member.capability)).resolves.toMatchObject({
      ok: true,
      result: { relay: { accepted: true } }
    })

    expect(strandedOnHost()).toEqual([])
    expect((await leadInbox(member)).map((message) => message.body)).toContain(
      'ORCA-1414: the second fix is pushed at 63b0ff4ad4.'
    )
  })

  it('takes --to Run home from a member whose Dispatch is still active', async () => {
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

    await expect(report(capability)).resolves.toMatchObject({
      ok: true,
      result: { relay: { dispatchId, accepted: true } }
    })
    await homeRuntime.syncOrchestrationFederatedDispatch(dispatchId)
    expect(homeDb.getUnreadMessages(`run:${run.id}`).map((message) => message.body)).toContain(
      'ORCA-1414: the second fix is pushed at 63b0ff4ad4.'
    )
  })

  it('lets ask --to Run home reopen a settled member like a bare ask', async () => {
    const member = await settledMember()

    await expect(
      workerCall(
        'orchestration.ask',
        { to: RUN_HOME, question: 'May I extend the PR?', timeoutMs: 1 },
        member.capability
      )
    ).resolves.toMatchObject({ ok: true, result: { timedOut: true } })

    expect(workerDb.getRemoteDispatchAttachment(member.dispatchId)).toMatchObject({
      state: 'ready',
      stage: 'reopened_by_member_ask'
    })
    homeRuntime.syncOrchestrationFederationReopenWatch()
    await vi.waitFor(() => expect(homeDb.listPendingQuestions(member.runId)).toHaveLength(1))
  })

  it('refuses on the host, naming why, once the member is released', async () => {
    const member = await settledMember()
    workerDb.markRemoteAttachmentReleased(member.dispatchId)

    const refused = await report(member.capability)

    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: 'dispatch_inactive',
        message: expect.stringContaining(`Dispatch ${member.dispatchId} on this pane is released`)
      }
    })
    expect((refused as { error: { message: string } }).error.message).toContain(
      'Print your report in this terminal'
    )
    expect(strandedOnHost()).toEqual([])
    expect(workerDb.listPendingFederationRelay(member.dispatchId, 'to_home')).toHaveLength(0)
  })

  it('refuses a wrong capability and tells the lead a report was refused', async () => {
    const member = await settledMember()

    const refused = await report('dcap_someone_else')

    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: 'dispatch_capability_invalid',
        message: expect.stringContaining('--dispatch-capability')
      }
    })
    expect(strandedOnHost()).toEqual([])
    const notice = (await leadInbox(member))[0]
    expect(notice.body).toContain('was refused on its host')
    expect(notice.body).not.toContain('second fix')
  })

  it('refuses a question sent with send and points to ask', async () => {
    const member = await settledMember()

    await expect(report(member.capability, { type: 'question' })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_argument',
        message: expect.stringContaining('orca orchestration ask')
      }
    })
    expect(strandedOnHost()).toEqual([])
    expect(workerDb.listPendingFederationRelay(member.dispatchId, 'to_home')).toHaveLength(0)
  })

  it('refuses on the host when the lead predates reading a settled member', async () => {
    workerCapabilities = workerCapabilities.filter(
      (capability) => capability !== ORCHESTRATION_FEDERATION_MEMBER_REOPEN_RUNTIME_CAPABILITY
    )
    const member = await settledMember()
    expect(workerDb.getRemoteDispatchAttachment(member.dispatchId)?.protocol_version).toBe(3)

    await expect(report(member.capability)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'dispatch_reopen_unsupported',
        message: expect.stringContaining("update the lead's Orca")
      }
    })
    expect(strandedOnHost()).toEqual([])
    expect(workerDb.listPendingFederationRelay(member.dispatchId, 'to_home')).toHaveLength(0)
  })

  it('keeps plain mail to a real terminal on the host local', async () => {
    const member = await settledMember()

    await expect(
      report(member.capability, { to: 'term_windows_setup', body: 'local note' })
    ).resolves.toMatchObject({ ok: true, result: { message: { to_handle: 'term_windows_setup' } } })
    expect(workerDb.listPendingFederationRelay(member.dispatchId, 'to_home')).toHaveLength(0)
  })
})
