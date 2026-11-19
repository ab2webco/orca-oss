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
  /** True while the PTY's foreground is the agent, false at its shell or gone, null when unknown. */
  runsAgent: (ptyId: string) => Promise<boolean | null>
  now?: () => number
}

export type ConversationResume = {
  agent: string
  providerSession: AgentProviderSessionMetadata
  connectionId: string | null
  paneKey: string | null
  ptyId?: string
}

/**
 * Another pane whose agent runs this conversation in the foreground now. Why the foreground
 * (ORCA-1283): a status row outlives an agent that exited to its shell.
 */
export async function paneHoldingConversation(
  deps: ConversationHolderDeps,
  ask: ConversationResume
): Promise<string | null> {
  const holders = deps
    .statuses()
    .filter(
      (one) =>
        one.paneKey !== ask.paneKey &&
        one.agentType === ask.agent &&
        (one.connectionId ?? null) === ask.connectionId &&
        agentProviderSessionsEqual(ask.agent, one.providerSession, ask.providerSession)
    )
  for (const one of holders) {
    const ptyId = deps.boundPtyIdOf(one.paneKey) ?? deps.persistedPtyIdOf(one.paneKey)
    // Why only a proven agent: an unknown one must not cost the pane its resume.
    if (ptyId && ptyId !== ask.ptyId && (await deps.runsAgent(ptyId).catch(() => null))) {
      return one.paneKey
    }
  }
  return null
}

// Why: a claimed resume's agent is not in the foreground until its spawn and startup finish.
const CLAIM_STARTING_MS = 15_000

type RestoreClaim = { owner: string; paneKey: string | null; ptyId?: string; at: number }

/** One resume per conversation at a time: two panes restored together must not both resume it. */
export class ConversationRestores {
  private readonly claims = new Map<string, RestoreClaim>()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: ConversationHolderDeps) {}

  /** The pane already holding the conversation, else null after claiming it for this resume. */
  admit(ask: ConversationResume): Promise<string | null> {
    const key = JSON.stringify([
      ask.agent,
      ask.connectionId,
      ask.providerSession.key,
      ask.providerSession.id,
      ask.providerSession.transcriptPath ?? null
    ])
    const owner = ask.paneKey ?? ask.ptyId ?? null
    const next = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const claim = this.claims.get(key)
        if (claim && claim.owner !== owner && (await this.holds(claim))) {
          return claim.paneKey ?? claim.owner
        }
        const heldBy = await paneHoldingConversation(this.deps, ask)
        if (heldBy === null) {
          const at = this.deps.now?.() ?? Date.now()
          this.claims.set(key, {
            owner: owner ?? `claim:${at}`,
            paneKey: ask.paneKey,
            ptyId: ask.ptyId,
            at
          })
        }
        return heldBy
      })
    this.queues.set(key, next)
    return next
  }

  private async holds(claim: RestoreClaim): Promise<boolean> {
    if ((this.deps.now?.() ?? Date.now()) - claim.at < CLAIM_STARTING_MS) {
      return true
    }
    const ptyId = (claim.paneKey && this.deps.boundPtyIdOf(claim.paneKey)) || claim.ptyId
    return ptyId ? (await this.deps.runsAgent(ptyId).catch(() => null)) === true : false
  }
}

/** The env without the startup line a sequenced launch would run once the shell is up. */
export function withoutSequencedStartupCommand(
  env: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => key !== SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV)
  )
}
