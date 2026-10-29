import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../../shared/protocol-version'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import type { OrchestrationEnvironmentTransport } from '../../orchestration/environment-transport'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import { ORCHESTRATION_METHODS } from './orchestration'
import { createFederationWorkerStartRequest as startRequest } from './orchestration-federation-test-request'
import { configureWorkerRuntime } from './orchestration-federation-worker-runtime-mocks'

// ORCA-857: a remote member's refused mail used to vanish; the lead must learn of it.
describe('undeliverable remote member mail', () => {
  let homeDb: OrchestrationDb
  let workerDb: OrchestrationDb
  let homeRuntime: OrcaRuntimeService
  let workerRuntime: OrcaRuntimeService
  let homeDispatcher: RpcDispatcher
  let workerDispatcher: RpcDispatcher

  beforeEach(() => {
    homeDb = new OrchestrationDb(':memory:')
    workerDb = new OrchestrationDb(':memory:')
    workerRuntime = new OrcaRuntimeService()
    workerRuntime.setOrchestrationDb(workerDb)
    configureWorkerRuntime(workerRuntime)
    workerDispatcher = new RpcDispatcher({ runtime: workerRuntime, methods: ORCHESTRATION_METHODS })
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
  })

  async function startRemoteMember() {
    const run = homeDb.createRun({
      objective: 'Mac to Windows',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
    const task = homeDb.createTask({ spec: 'Audit Windows behavior', runId: run.id })
    expect((await homeDispatcher.dispatch(startRequest(task.id))).ok).toBe(true)
    return { runId: run.id, dispatchId: homeDb.getDispatchContext(task.id)!.id }
  }

  function memberCall(
    id: string,
    method: 'orchestration.send' | 'orchestration.ask',
    params: Record<string, unknown>,
    capability?: string
  ): Promise<unknown> {
    const request: RpcRequest = {
      id: `rpc_${id}`,
      authToken: 'worker-local-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: `request_${id}`,
      ...(capability ? { orchestrationCapability: capability } : {}),
      method,
      params: { from: 'term_windows_worker', ...params }
    }
    return workerDispatcher.dispatch(request)
  }

  async function leadNotices(runId: string) {
    await homeRuntime.syncOrchestrationFederation()
    return homeDb
      .getRunMailboxHistory(runId, 20)
      .filter((message) => message.subject.startsWith('Undelivered '))
  }

  it('tells the member how to recover and the lead that a send without its capability was refused', async () => {
    const { runId, dispatchId } = await startRemoteMember()

    const refused = await memberCall('gate', 'orchestration.send', {
      type: 'decision_gate',
      subject: 'Secret plan',
      body: 'Should I merge #1051?'
    })

    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: 'dispatch_capability_invalid',
        message: expect.stringMatching(
          /decision_gate was not delivered: it carried no --dispatch-capability\. Re-run the same command with --dispatch-capability .*The lead was told/
        )
      }
    })
    const notices = await leadNotices(runId)
    expect(notices).toEqual([
      expect.objectContaining({
        type: 'escalation',
        priority: 'high',
        subject: `Undelivered decision_gate from Dispatch ${dispatchId}`,
        body: expect.stringContaining(`orca orchestration worker-read --dispatch ${dispatchId}`)
      })
    ])
    // Why: the refused caller is unauthenticated, so none of its text may reach the lead.
    expect(notices[0].body).not.toContain('#1051')
  })

  it('surfaces a refused ask once per window instead of once per retry', async () => {
    const { runId, dispatchId } = await startRemoteMember()
    const prompt = vi.mocked(workerRuntime.sendTerminalAgentPrompt).mock.calls[0]?.[1] ?? ''
    const capability = prompt.match(/--dispatch-capability (dcap_[A-Za-z0-9_-]+)/)?.[1]
    expect(capability).toBeTruthy()

    for (const id of ['ask_1', 'ask_2']) {
      await expect(
        memberCall(id, 'orchestration.ask', { question: 'Merge?' }, `${capability}x`)
      ).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'dispatch_capability_invalid',
          message: expect.stringContaining(
            'question was not delivered: its --dispatch-capability does not match this Dispatch.'
          )
        }
      })
    }

    expect(await leadNotices(runId)).toEqual([
      expect.objectContaining({ subject: `Undelivered question from Dispatch ${dispatchId}` })
    ])
  })

  it('surfaces a send from a shell without the pane launch token', async () => {
    const { runId, dispatchId } = await startRemoteMember()
    vi.spyOn(workerRuntime, 'authenticateOrchestrationSender').mockImplementation(() => {
      throw new Error('orchestration_sender_unauthenticated')
    })

    await expect(
      memberCall('unauthenticated', 'orchestration.send', {
        type: 'escalation',
        subject: 'Blocked',
        senderPaneKey: 'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'orchestration_sender_unauthenticated',
        message: expect.stringContaining(
          "ORCA_AGENT_LAUNCH_TOKEN. Run the command from the member's own agent session"
        )
      }
    })
    expect(await leadNotices(runId)).toEqual([
      expect.objectContaining({ subject: `Undelivered escalation from Dispatch ${dispatchId}` })
    ])
  })

  it('keeps a refused heartbeat off the lead inbox', async () => {
    const { runId } = await startRemoteMember()
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      memberCall('heartbeat', 'orchestration.send', { type: 'heartbeat', subject: 'alive' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'dispatch_capability_invalid' } })

    expect(await leadNotices(runId)).toEqual([])
  })
})
