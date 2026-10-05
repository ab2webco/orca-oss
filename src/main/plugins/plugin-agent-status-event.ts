import { AGENT_TYPE_MAX_LENGTH, type AgentStatusPayload } from '../../shared/agent-status-types'
import type { PluginAgentStatusChangedPayload } from '../../shared/plugins/plugin-events'

/** The slice of an enriched hook status event the plugin projection reads. */
export type AgentStatusEventSource = {
  worktreeId?: string
  paneKey: string
  receivedAt: number
  payload: Pick<AgentStatusPayload, 'state' | 'agentType' | 'sessionBoundary'>
}

function projectAgentType(agentType: string | undefined): string | undefined {
  const trimmed = agentType?.trim()
  // Why: the hook pipeline treats a literal 'unknown' as no claim. It already truncates
  // agentType to AGENT_TYPE_MAX_LENGTH, so the length check only guards a source that skips
  // that normalizer: an oversized value would fail the schema and drop the whole event.
  if (!trimmed || trimmed === 'unknown' || trimmed.length > AGENT_TYPE_MAX_LENGTH) {
    return undefined
  }
  return trimmed
}

/** Builds the bounded `agent.status.changed` payload; prompts, tools and output never leave main. */
export function projectAgentStatusChangedEvent(
  source: AgentStatusEventSource
): PluginAgentStatusChangedPayload {
  const { state } = source.payload
  const agentType = projectAgentType(source.payload.agentType)
  return {
    worktreeId: source.worktreeId ?? null,
    paneKey: source.paneKey,
    state,
    receivedAt: source.receivedAt,
    ...(agentType !== undefined ? { agentType } : {}),
    ...(state === 'done' && source.payload.sessionBoundary === true
      ? { sessionBoundary: true as const }
      : {})
  }
}

type AgentStatusEventTap = {
  subscribeEnrichedStatus(listener: (event: AgentStatusEventSource) => void): () => void
}

type EmitAgentStatusChanged = (
  event: 'agent.status.changed',
  payload: PluginAgentStatusChangedPayload
) => void

/** Routes every enriched hook status through the bounded projection to the plugin bus. */
export function wirePluginAgentStatusEvents(
  tap: AgentStatusEventTap,
  emit: EmitAgentStatusChanged
): () => void {
  return tap.subscribeEnrichedStatus((enriched) => {
    emit('agent.status.changed', projectAgentStatusChangedEvent(enriched))
  })
}
