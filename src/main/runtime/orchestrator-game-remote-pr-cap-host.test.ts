import { afterEach, describe, expect, it, vi } from 'vitest'
import { gamePrCapVerdictOf } from '../../shared/orchestrator-game-pr-cap'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'
import type { RpcContext } from './rpc/core'
import { ORCHESTRATION_FEDERATION_CONTROL_METHODS } from './rpc/methods/orchestration-federation-control'

const show = ORCHESTRATION_FEDERATION_CONTROL_METHODS.find(
  (method) => method.name === 'orchestration.federationShow'
)!
const MEMBER_PANE = 'tab-9:99999999-9999-4999-8999-999999999999'
const MEMBER = { terminalHandle: 'term_member', paneKey: MEMBER_PANE }

// The member's own host: its lead runs on another host, which only reaches it through federationShow.
describe("a paired host's member at its remote lead's open-PR cap (ORCA-1301)", () => {
  const databases: OrchestrationDb[] = []

  afterEach(() => {
    for (const database of databases) {
      database.close()
    }
    databases.length = 0
  })

  function memberHost(): OrcaRuntimeService {
    const runtime = new OrcaRuntimeService(null)
    vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({ worktrees: [] } as never)
    const db = new OrchestrationDb(':memory:')
    databases.push(db)
    runtime.setOrchestrationDb(db)
    db.createRemoteDispatchAttachment({
      dispatchId: 'ctx_remote',
      taskId: 'task_remote',
      homePeerFingerprint: 'fp_home',
      protocolVersion: 2,
      runtimeEpoch: runtime.getRuntimeId(),
      mutationReceipt: {
        callerFingerprint: 'fp_home',
        requestId: 'attach',
        method: 'orchestration.federationAttachStart',
        payloadHash: 'attach-payload'
      }
    })
    db.prepareRemoteAttachmentAuthority({
      dispatchId: 'ctx_remote',
      paneKey: MEMBER_PANE,
      processIncarnation: 'proc-1',
      worktreeId: 'repo::member',
      terminalHandle: 'term_member',
      setupState: 'not_applicable',
      effects: []
    })
    db.markRemoteAttachmentReady('ctx_remote')
    return runtime
  }

  const showFromHome = (runtime: OrcaRuntimeService, params: Record<string, unknown>) =>
    show.handler({ dispatchId: 'ctx_remote', ...params }, {
      runtime,
      authenticatedCallerFingerprint: 'fp_home'
    } as RpcContext)

  it("refuses its gh pr create from the count its lead's home sent", async () => {
    const runtime = memberHost()

    // Why: a bad count must drop, not fail the lead's whole read of its members.
    expect(show.params!.parse({ dispatchId: 'ctx_remote', prCap: { open: -1, cap: 0 } })).toEqual({
      dispatchId: 'ctx_remote'
    })
    await showFromHome(runtime, { prCap: { open: 6, cap: 6 } })
    const cap = await runtime.readGamePrCap(MEMBER)

    expect(cap).toEqual({ member: true, open: 6, cap: 6 })
    expect(gamePrCapVerdictOf(cap)).toMatchObject({
      kind: 'refuse',
      line: expect.stringContaining('6 open PRs and its cap is 6')
    })
  })

  it('says why it is unchecked when an older home sent no count', async () => {
    const runtime = memberHost()

    await showFromHome(runtime, {})
    const cap = await runtime.readGamePrCap(MEMBER)

    expect(cap).toEqual({ member: true, unknown: expect.stringContaining('an older Orca there') })
    expect(gamePrCapVerdictOf(cap).kind).toBe('unchecked')
  })
})
