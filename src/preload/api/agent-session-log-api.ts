import type {
  AgentSessionLogPaneReading,
  AgentSessionLogReading
} from '../../shared/agent-session-log-state'
import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'
import type { ResumableTuiAgent } from '../../shared/agent-session-resume'

export type AgentSessionLogApi = {
  /** Batch pane → session-log reading: agent state and what it is doing, read
   *  from the transcript rather than a terminal buffer. One call per tick. */
  readPanes: (paneKeys: string[]) => Promise<AgentSessionLogPaneReading[]>
  /** Reads turn state for one already-known provider-session identity — used
   *  when the caller already holds a persisted resume record (agent +
   *  providerSession) rather than a live pane key to look up in the hook
   *  cache. Independent of that cache, so it still answers after the pane's
   *  live status has been dropped (e.g. mid-close). */
  readForIdentity: (identity: {
    agent: ResumableTuiAgent
    providerSession: AgentProviderSessionMetadata
  }) => Promise<AgentSessionLogReading>
}
