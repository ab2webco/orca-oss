import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../../shared/protocol-version'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATION_METHODS } from './orchestration'

describe('orchestration federated message targeting', () => {
  let db: OrchestrationDb | undefined
  let runtime: OrcaRuntimeService | undefined

  afterEach(() => {
    runtime?.stopOrchestrationFederationRelay()
    db?.close()
  })

  it('rejects explicit send and ask targets without enqueueing a relay', async () => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    const paneKey = 'tab_worker:leaf_worker'
    const processIncarnation = 'worker_epoch:pty:1'
    const dispatchId = 'ctx_remote_targeting'
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue(paneKey)
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockReturnValue(processIncarnation)
    db.createRemoteDispatchAttachment({
      dispatchId,
      taskId: 'task_remote_targeting',
      homePeerFingerprint: 'home_peer',
      protocolVersion: 1,
      runtimeEpoch: runtime.getRuntimeId(),
      mutationReceipt: {
        callerFingerprint: 'home_peer',
        requestId: 'attach_request',
        method: 'orchestration.federationAttachStart',
        payloadHash: 'attach_payload'
      }
    })
    const capability = db.prepareRemoteAttachmentAuthority({
      dispatchId,
      paneKey,
      processIncarnation,
      worktreeId: 'repo::remote-worktree',
      terminalHandle: 'term_remote_worker',
      setupState: 'not_applicable',
      effects: []
    })
    db.markRemoteAttachmentReady(dispatchId)
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATION_METHODS })
    const requests: RpcRequest[] = [
      request('send_to', capability, 'orchestration.send', {
        from: 'term_remote_worker',
        to: 'run:explicit',
        subject: 'Wrong explicit target'
      }),
      request('send_run', capability, 'orchestration.send', {
        from: 'term_remote_worker',
        run: 'run_explicit',
        subject: 'Wrong explicit Run'
      }),
      request('ask_to', capability, 'orchestration.ask', {
        from: 'term_remote_worker',
        to: 'run:explicit',
        question: 'Wrong explicit target?'
      }),
      request('ask_run', capability, 'orchestration.ask', {
        from: 'term_remote_worker',
        run: 'run_explicit',
        question: 'Wrong explicit Run?'
      })
    ]

    for (const item of requests) {
      await expect(dispatcher.dispatch(item)).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'invalid_argument',
          message: 'Federated Dispatch messages route to their Run home; omit --to and --run.'
        }
      })
    }
    expect(
      db.listFederationRelay({ dispatchId, direction: 'to_home', afterSequence: 0 })
    ).toHaveLength(0)
  })

  // ORCA-677: the worker host is where the remote terminal lives, so it is the one that can tell it is gone.
  it('rejects and logs a remote heartbeat whose terminal is gone or remounted, without relaying it', async () => {
    db = new OrchestrationDb(':memory:')
    runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    const paneKey = 'tab_worker:leaf_worker'
    const dispatchId = 'ctx_remote_ghost'
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue(paneKey)
    const incarnation = vi.spyOn(runtime, 'getTerminalProcessIncarnation')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.createRemoteDispatchAttachment({
      dispatchId,
      taskId: 'task_remote_ghost',
      homePeerFingerprint: 'home_peer',
      protocolVersion: 1,
      runtimeEpoch: runtime.getRuntimeId(),
      mutationReceipt: {
        callerFingerprint: 'home_peer',
        requestId: 'attach_request',
        method: 'orchestration.federationAttachStart',
        payloadHash: 'attach_payload'
      }
    })
    const capability = db.prepareRemoteAttachmentAuthority({
      dispatchId,
      paneKey,
      processIncarnation: 'worker_epoch:pty:1',
      worktreeId: 'repo::remote-worktree',
      terminalHandle: 'term_remote_worker',
      setupState: 'not_applicable',
      effects: []
    })
    db.markRemoteAttachmentReady(dispatchId)
    const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATION_METHODS })
    const heartbeat = (id: string) =>
      request(id, capability, 'orchestration.send', {
        from: 'term_remote_worker',
        senderPaneKey: paneKey,
        subject: 'alive',
        type: 'heartbeat',
        payload: JSON.stringify({ dispatchId })
      })

    for (const [id, live] of [
      ['gone', null],
      ['remounted', 'worker_epoch:pty:2']
    ] as const) {
      incarnation.mockReturnValue(live)
      await expect(dispatcher.dispatch(heartbeat(id))).resolves.toMatchObject({
        ok: false,
        error: { code: 'dispatch_capability_invalid' }
      })
    }
    expect(
      db.listFederationRelay({ dispatchId, direction: 'to_home', afterSequence: 0 })
    ).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[orchestration] heartbeat rejected'),
      expect.objectContaining({ dispatchId })
    )

    // Control: the live process is relayed to its Run home.
    incarnation.mockReturnValue('worker_epoch:pty:1')
    await expect(dispatcher.dispatch(heartbeat('live'))).resolves.toMatchObject({ ok: true })
    expect(
      db.listFederationRelay({ dispatchId, direction: 'to_home', afterSequence: 0 })
    ).toHaveLength(1)
  })
})

function request(
  id: string,
  capability: string,
  method: 'orchestration.send' | 'orchestration.ask',
  params: Record<string, unknown>
): RpcRequest {
  return {
    id: `rpc_${id}`,
    authToken: 'worker-token',
    orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
    orchestrationRequestId: `request_${id}`,
    orchestrationCapability: capability,
    method,
    params
  }
}
