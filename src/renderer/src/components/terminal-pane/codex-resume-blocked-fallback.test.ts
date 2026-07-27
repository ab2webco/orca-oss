import { describe, expect, it } from 'vitest'
import {
  CODEX_RESUME_BLOCKED_MESSAGE,
  isCodexResumeBlockedError,
  type SleepingAgentSessionRecord
} from '../../../../shared/agent-session-resume'
import { resolveCodexResumeBlockedProviderSession } from './codex-resume-blocked-fallback'

const PROVIDER_SESSION = {
  key: 'session_id' as const,
  id: '019f9c89-244d-7232-b6e6-0874d3557f76',
  transcriptPath: '/home/sessions/2026/07/26/rollout-2026-07-26T00-17-55-019f9c89.jsonl'
}

function sleepingRecord(agent: SleepingAgentSessionRecord['agent']): SleepingAgentSessionRecord {
  return {
    paneKey: 'tab:leaf',
    worktreeId: 'wt-1',
    agent,
    providerSession: PROVIDER_SESSION,
    prompt: '',
    state: 'working',
    capturedAt: 1,
    updatedAt: 2
  }
}

describe('isCodexResumeBlockedError', () => {
  it('matches the guard message inside the Electron invoke wrapper', () => {
    expect(
      isCodexResumeBlockedError(
        `Error invoking remote method 'pty:spawn': Error: ${CODEX_RESUME_BLOCKED_MESSAGE}`
      )
    ).toBe(true)
  })

  it('ignores unrelated spawn errors', () => {
    expect(isCodexResumeBlockedError('shell exited with code 1')).toBe(false)
  })
})

describe('resolveCodexResumeBlockedProviderSession', () => {
  it('prefers the startup metadata the blocked spawn was launched with', () => {
    expect(
      resolveCodexResumeBlockedProviderSession({
        startupLaunchAgent: 'codex',
        startupProviderSession: PROVIDER_SESSION,
        liveEntry: undefined,
        sleepingRecord: undefined
      })
    ).toEqual(PROVIDER_SESSION)
  })

  it('ignores startup metadata from a non-codex launch', () => {
    expect(
      resolveCodexResumeBlockedProviderSession({
        startupLaunchAgent: 'claude',
        startupProviderSession: PROVIDER_SESSION,
        liveEntry: undefined,
        sleepingRecord: undefined
      })
    ).toBeNull()
  })

  it('falls back to the live codex hook entry, then the sleeping record', () => {
    expect(
      resolveCodexResumeBlockedProviderSession({
        startupLaunchAgent: undefined,
        startupProviderSession: undefined,
        liveEntry: { agentType: 'codex', providerSession: PROVIDER_SESSION },
        sleepingRecord: undefined
      })
    ).toEqual(PROVIDER_SESSION)
    expect(
      resolveCodexResumeBlockedProviderSession({
        startupLaunchAgent: undefined,
        startupProviderSession: undefined,
        liveEntry: { agentType: 'claude', providerSession: PROVIDER_SESSION },
        sleepingRecord: sleepingRecord('codex')
      })
    ).toEqual(PROVIDER_SESSION)
  })

  it('returns null when no codex session metadata exists for the pane', () => {
    expect(
      resolveCodexResumeBlockedProviderSession({
        startupLaunchAgent: undefined,
        startupProviderSession: undefined,
        liveEntry: undefined,
        sleepingRecord: sleepingRecord('claude')
      })
    ).toBeNull()
  })
})
