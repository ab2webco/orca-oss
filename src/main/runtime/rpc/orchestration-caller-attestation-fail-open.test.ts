// Why: ORCA-370. `assertCallerHandleMatchesEvidence` only ran when the request carried evidence,
// and the CLI builds that evidence purely from env — so dropping ORCA_AGENT_LAUNCH_TOKEN removed
// the check instead of failing it. Measured against a live runtime before the fix:
//   env -u ORCA_AGENT_LAUNCH_TOKEN orca orchestration run-current --from <coordinator handle>
//   => { "ok": true }   (with the token present the same call returns consumer_fenced)
import { afterEach, describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime'
import {
  cleanupLegacyCompatibilityDispatcherHarnesses,
  createHarness,
  currentEvidence,
  CURRENT_COORDINATOR_HANDLE,
  CURRENT_COORDINATOR_PANE,
  CURRENT_WORKER_HANDLE,
  requireAttestationFor,
  request,
  type LegacyCompatibilityDispatcherHarness
} from './orchestration-legacy-compatibility-dispatcher-test-fixture'

afterEach(() => {
  cleanupLegacyCompatibilityDispatcherHarnesses()
})

/** Evidence a caller can produce by unsetting the launch token: shape kept, secret gone. */
function withoutLaunchToken(role: 'worker' | 'coordinator') {
  return { ...currentEvidence(role), launchToken: '' }
}

function bindCoordinatorRun(harness: LegacyCompatibilityDispatcherHarness): string {
  return harness.db.createRun({
    objective: 'coordinator work',
    coordinatorHandle: CURRENT_COORDINATOR_HANDLE,
    coordinatorPaneKey: CURRENT_COORDINATOR_PANE
  }).id
}

describe('ORCA-370 — a caller with no launch evidence may not name an attested pane', () => {
  it('refuses runCurrent from an unattested caller naming the coordinator pane', async () => {
    const harness = createHarness()
    requireAttestationFor(harness, [CURRENT_COORDINATOR_HANDLE, CURRENT_WORKER_HANDLE])
    const runId = bindCoordinatorRun(harness)

    const response = (await harness.dispatcher.dispatch(
      request(
        'orchestration.runCurrent',
        { from: CURRENT_COORDINATOR_HANDLE },
        withoutLaunchToken('worker'),
        'orca-370-run-current-spoof'
      )
    )) as { ok: boolean; error?: { code: string }; result?: { run?: { id: string } | null } }

    expect(response).toMatchObject({ ok: false, error: { code: 'consumer_fenced' } })
    // Why: the refusal must also withhold the binding it was asked to disclose.
    expect(response.result?.run?.id).not.toBe(runId)
  })

  it('refuses runCreate from an unattested caller and creates no Run', async () => {
    const harness = createHarness()
    requireAttestationFor(harness, [CURRENT_COORDINATOR_HANDLE, CURRENT_WORKER_HANDLE])
    const before = harness.db.listRuns().runs

    const response = await harness.dispatcher.dispatch(
      request(
        'orchestration.runCreate',
        { objective: 'run claimed without evidence', from: CURRENT_COORDINATOR_HANDLE },
        withoutLaunchToken('worker'),
        'orca-370-run-create-spoof'
      )
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'consumer_fenced' } })
    expect(harness.db.listRuns().runs).toEqual(before)
  })

  it('still admits the attested coordinator naming itself', async () => {
    const harness = createHarness()
    requireAttestationFor(harness, [CURRENT_COORDINATOR_HANDLE, CURRENT_WORKER_HANDLE])
    const runId = bindCoordinatorRun(harness)

    const response = await harness.dispatcher.dispatch(
      request(
        'orchestration.runCurrent',
        { from: CURRENT_COORDINATOR_HANDLE },
        currentEvidence('coordinator'),
        'orca-370-coordinator-happy-path'
      )
    )

    expect(response).toMatchObject({ ok: true, result: { run: { id: runId } } })
  })

  it('still admits an unattested caller on a pane that holds no launch secret', async () => {
    // Why: SSH panes without remote hooks and hand-opened shells never get a launch token, and
    // fencing them would close a supported case instead of the hole.
    const harness = createHarness()
    requireAttestationFor(harness, [])
    const runId = bindCoordinatorRun(harness)

    const response = await harness.dispatcher.dispatch(
      request(
        'orchestration.runCurrent',
        { from: CURRENT_COORDINATOR_HANDLE },
        withoutLaunchToken('coordinator'),
        'orca-370-unattested-pane'
      )
    )

    expect(response).toMatchObject({ ok: true, result: { run: { id: runId } } })
  })
})

/** Why: requireAttestationFor stubs the predicate, so its real body needs a runtime with live PTYs. */
describe('ORCA-370 — which panes the runtime says must attest', () => {
  type RuntimeInternals = {
    recordPtyWorktree: (
      ptyId: string,
      worktreeId: string,
      state: Record<string, unknown>
    ) => { launchToken: string | null }
    issuePtyHandle: (pty: unknown) => string
    ptysById: Map<string, { launchToken: string | null }>
    handleByPtyId: Map<string, string>
    restoredOrchestrationAuthorityByPtyId: Map<string, Record<string, unknown>>
  }

  function livePane(options: { launchToken?: string; restored?: boolean }): {
    runtime: OrcaRuntimeService
    handle: string
  } {
    const runtime = new OrcaRuntimeService()
    const internals = runtime as unknown as RuntimeInternals
    const handle = 'term_pane_under_test'
    const ptyId = 'pty_pane_under_test'
    const pty = internals.recordPtyWorktree(ptyId, 'repo::/worktree', {
      connected: true,
      paneKey: 'tab_pane:77777777-7777-4777-8777-777777777777',
      incarnationId: 'incarnation-pane'
    })
    internals.handleByPtyId.set(ptyId, handle)
    internals.issuePtyHandle(pty)
    pty.launchToken = options.launchToken ?? null
    if (options.restored) {
      internals.restoredOrchestrationAuthorityByPtyId.set(ptyId, { ptyId })
    }
    return { runtime, handle }
  }

  it('requires attestation for a pane holding a live launch secret', () => {
    const { runtime, handle } = livePane({ launchToken: 'pane-launch-token' })

    expect(runtime.orchestrationCallerRequiresAttestation(handle)).toBe(true)
  })

  it('leaves a restored surface with no launch secret free to name itself', () => {
    // Why: Orca records a restore receipt for every exact restored surface, plain shells included,
    // and that receipt holds no token. Fencing on it would deny the pane itself, not just impostors.
    const { runtime, handle } = livePane({ restored: true })

    expect(runtime.orchestrationCallerRequiresAttestation(handle)).toBe(false)
  })

  it('leaves a pane with no launch authority free to name itself', () => {
    const { runtime, handle } = livePane({})

    expect(runtime.orchestrationCallerRequiresAttestation(handle)).toBe(false)
  })

  it('does not require attestation for a handle the runtime cannot resolve', () => {
    const { runtime } = livePane({ launchToken: 'pane-launch-token' })

    expect(runtime.orchestrationCallerRequiresAttestation('term_unknown')).toBe(false)
  })
})
