import {
  normalizeAgentProviderSession,
  type AgentProviderSessionMetadata,
  type SleepingAgentSessionRecord
} from '../../../../shared/agent-session-resume'
import type { TuiAgent } from '../../../../shared/types'

/**
 * The provider session a guard-blocked Codex resume was launched with, so the
 * pane can show that exact transcript read-only instead of going blank. Mirrors
 * the spawn's own precedence: explicit startup metadata, then the live hook
 * entry, then the sleeping record (the cold-restore source).
 */
export function resolveCodexResumeBlockedProviderSession(args: {
  startupLaunchAgent: TuiAgent | undefined
  startupProviderSession: AgentProviderSessionMetadata | undefined
  liveEntry: { agentType?: string; providerSession?: unknown } | undefined
  sleepingRecord: SleepingAgentSessionRecord | undefined
}): AgentProviderSessionMetadata | null {
  if (args.startupLaunchAgent === 'codex') {
    const fromStartup = normalizeAgentProviderSession(args.startupProviderSession)
    if (fromStartup) {
      return fromStartup
    }
  }
  if (args.liveEntry?.agentType === 'codex') {
    const fromLiveEntry = normalizeAgentProviderSession(args.liveEntry.providerSession)
    if (fromLiveEntry) {
      return fromLiveEntry
    }
  }
  if (args.sleepingRecord?.agent === 'codex') {
    return normalizeAgentProviderSession(args.sleepingRecord.providerSession)
  }
  return null
}
