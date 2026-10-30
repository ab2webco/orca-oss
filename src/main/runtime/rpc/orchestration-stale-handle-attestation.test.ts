// Why: ORCA-835. A lead whose PTY outlived an Orca restart kept its old ORCA_TERMINAL_HANDLE while
// the pane got a new one. The CLI reminted the caller handle from ORCA_PANE_KEY, but the launch
// evidence still named the old handle, so every lead-only call was refused with consumer_fenced.
import { describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime'
import { assertCallerHandleMatchesEvidence } from './methods/orchestration-run-scope'

const PANE_KEY = 'tab_lead:77777777-7777-4777-8777-777777777777'
const OTHER_PANE_KEY = 'tab_other:88888888-8888-4888-8888-888888888888'
const LAUNCH_TOKEN = 'lead-launch-token'
const CURRENT_HANDLE = 'term_current_lead'
const STALE_HANDLE = 'term_before_restart'

type RuntimeInternals = {
  recordPtyWorktree: (
    ptyId: string,
    worktreeId: string,
    state: Record<string, unknown>
  ) => { launchToken: string | null }
  issuePtyHandle: (pty: unknown) => string
  handleByPtyId: Map<string, string>
}

function leadPaneAfterRestart(): OrcaRuntimeService {
  const runtime = new OrcaRuntimeService(null, undefined, {
    attestAgentHookCompatibilityAuthority: ({ paneKey }) => ({
      paneKey,
      source: 'current_hook'
    })
  })
  const internals = runtime as unknown as RuntimeInternals
  const pty = internals.recordPtyWorktree('pty_lead', 'repo::/worktree', {
    connected: true,
    paneKey: PANE_KEY,
    incarnationId: 'incarnation-lead'
  })
  internals.handleByPtyId.set('pty_lead', CURRENT_HANDLE)
  internals.issuePtyHandle(pty)
  pty.launchToken = LAUNCH_TOKEN
  return runtime
}

describe('ORCA-835 — a resumed lead with a stale handle is still its own pane', () => {
  it('attests the pane by its key and launch token when the declared handle is stale', () => {
    const runtime = leadPaneAfterRestart()
    const evidence = { terminalHandle: STALE_HANDLE, paneKey: PANE_KEY, launchToken: LAUNCH_TOKEN }

    expect(runtime.verifyOrchestrationCompatibilityCaller(evidence)?.terminalHandle).toBe(
      CURRENT_HANDLE
    )
    expect(
      runtime.verifyOrchestrationCompatibilityCaller(evidence, {
        currentRuntimeLaunchSufficient: true
      })?.terminalHandle
    ).toBe(CURRENT_HANDLE)
    expect(() => assertCallerHandleMatchesEvidence(runtime, CURRENT_HANDLE, evidence)).not.toThrow()
  })

  it('still refuses a stale handle whose launch token does not match the pane', () => {
    const runtime = leadPaneAfterRestart()
    const evidence = { terminalHandle: STALE_HANDLE, paneKey: PANE_KEY, launchToken: 'forged' }

    expect(runtime.verifyOrchestrationCompatibilityCaller(evidence)).toBeNull()
    expect(() => assertCallerHandleMatchesEvidence(runtime, CURRENT_HANDLE, evidence)).toThrow(
      expect.objectContaining({ code: 'consumer_fenced' })
    )
  })

  it('does not adopt a different pane through a stale handle', () => {
    const runtime = leadPaneAfterRestart()

    expect(
      runtime.verifyOrchestrationCompatibilityCaller({
        terminalHandle: STALE_HANDLE,
        paneKey: OTHER_PANE_KEY,
        launchToken: LAUNCH_TOKEN
      })
    ).toBeNull()
  })

  it('names both handles when it fences a caller whose env handle differs', () => {
    const runtime = leadPaneAfterRestart()

    expect(() =>
      assertCallerHandleMatchesEvidence(runtime, CURRENT_HANDLE, {
        terminalHandle: STALE_HANDLE,
        paneKey: OTHER_PANE_KEY,
        launchToken: LAUNCH_TOKEN
      })
    ).toThrow(new RegExp(`${CURRENT_HANDLE}.*ORCA_TERMINAL_HANDLE is ${STALE_HANDLE}.*stale`))
  })
})
