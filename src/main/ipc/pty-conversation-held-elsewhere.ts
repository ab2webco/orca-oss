import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import {
  agentProviderSessionsEqual,
  type AgentProviderSessionMetadata
} from '../../shared/agent-session-resume'
import { SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV } from '../../shared/setup-agent-sequencing'

export type ConversationHolderDeps = {
  statuses: () => readonly AgentStatusIpcPayload[]
  /** The PTY bound to a pane in this run of Orca. */
  boundPtyIdOf: (paneKey: string) => string | undefined
  /** The PTY a pane had when the session was saved; covers a surviving pane not reattached yet. */
  persistedPtyIdOf: (paneKey: string) => string | undefined
  /** Null when the provider cannot tell. */
  isPtyLive: (ptyId: string) => Promise<boolean | null>
}

/**
 * Another pane whose PTY is proven live and whose agent last reported this conversation. Why
 * (ORCA-1283): a cold restore beside it would run a second agent on one conversation.
 */
export async function paneHoldingConversation(
  deps: ConversationHolderDeps,
  args: {
    agent: string
    providerSession: AgentProviderSessionMetadata
    paneKey: string | null
    ptyId?: string
  }
): Promise<string | null> {
  const holders = deps
    .statuses()
    .filter(
      (one) =>
        one.paneKey !== args.paneKey &&
        one.agentType === args.agent &&
        agentProviderSessionsEqual(args.agent, one.providerSession, args.providerSession)
    )
  for (const one of holders) {
    const ptyId = deps.boundPtyIdOf(one.paneKey) ?? deps.persistedPtyIdOf(one.paneKey)
    // Why only a proven-live PTY: an unknown one must not cost the pane its resume.
    if (ptyId && ptyId !== args.ptyId && (await deps.isPtyLive(ptyId).catch(() => null))) {
      return one.paneKey
    }
  }
  return null
}

/** The env without the startup line a sequenced launch would run once the shell is up. */
export function withoutSequencedStartupCommand(
  env: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => key !== SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV)
  )
}
