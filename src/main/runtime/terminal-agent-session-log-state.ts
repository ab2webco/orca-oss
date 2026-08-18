// Pane → session identity → log-derived agent state. The identity comes from the
// agent's own hook rows, never from the terminal title or a foreground process.

import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'
import type { AgentSessionLogReading } from '../../shared/agent-session-log-state'
import type { AgentType } from '../../shared/native-chat-types'
import type { RuntimeTerminalAgentSessionState } from '../../shared/runtime-types'
import { readAgentSessionLogState } from '../native-chat/session-log-agent-state'

export type AgentSessionIdentity = {
  agent: AgentType
  providerSession: AgentProviderSessionMetadata
}

/** Newest hook row for this pane that carried both an agent type and a session id. */
export function selectAgentSessionIdentity(
  handle: string,
  paneKey: string | null,
  statuses: readonly AgentStatusIpcPayload[]
): AgentSessionIdentity | null {
  let best: AgentSessionIdentity | null = null
  let bestAt = -1
  for (const entry of statuses) {
    if (entry.terminalHandle !== handle && (!paneKey || entry.paneKey !== paneKey)) {
      continue
    }
    // Why both: a pane whose agent is unknown must degrade visibly rather than
    // resolve some other agent's transcript shape (ORCA-191).
    if (!entry.agentType || !entry.providerSession?.id || entry.receivedAt <= bestAt) {
      continue
    }
    best = { agent: entry.agentType, providerSession: entry.providerSession }
    bestAt = entry.receivedAt
  }
  return best
}

export async function readTerminalAgentSessionLogState(
  handle: string,
  identity: AgentSessionIdentity | null
): Promise<RuntimeTerminalAgentSessionState> {
  if (!identity) {
    return { handle, agent: null, sessionId: null, session: unknownSession() }
  }
  const session = await readAgentSessionLogState({
    agent: identity.agent,
    sessionId: identity.providerSession.id,
    transcriptPath: identity.providerSession.transcriptPath
  })
  return {
    handle,
    agent: identity.agent,
    sessionId: identity.providerSession.id,
    session
  }
}

function unknownSession(): AgentSessionLogReading {
  return { read: false, reason: 'agent-session-unknown' }
}
