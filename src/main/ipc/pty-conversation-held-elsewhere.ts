import { recognizeAgentProcess } from '../../shared/agent-process-recognition'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import {
  agentProviderSessionsEqual,
  type AgentProviderSessionMetadata
} from '../../shared/agent-session-resume'
import { SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV } from '../../shared/setup-agent-sequencing'
import { leadPaneStateOf } from '../runtime/orchestrator-game-lead-sessions'

export type ConversationHolderDeps = {
  statuses: () => readonly AgentStatusIpcPayload[]
  /** The PTY bound to a pane in this run of Orca. */
  boundPtyIdOf: (paneKey: string) => string | undefined
  /** The PTY a pane had when the session was saved; covers a surviving pane not reattached yet. */
  persistedPtyIdOf: (paneKey: string) => string | undefined
  /** The PTY's foreground process name; null when it is gone or unreadable. */
  foregroundOf: (ptyId: string) => Promise<string | null>
  now?: () => number
}

export type ConversationResume = {
  agent: string
  providerSession: AgentProviderSessionMetadata
  connectionId: string | null
  paneKey: string | null
  ptyId?: string
}

/** Settle with the spawned PTY, or null when the spawn failed. */
export type RestoreAdmission = { heldBy: string | null; settle: (ptyId: string | null) => void }

export const NOT_CLAIMED: RestoreAdmission = { heldBy: null, settle: () => undefined }

/**
 * Whether a foreground process is this agent. Why a positive match (ORCA-1283): an editor, a dev
 * server, ssh or wsl.exe in front after the agent exited must not keep its conversation.
 */
export function foregroundRunsAgent(agent: string, foreground: string | null): boolean {
  if (!foreground) {
    return false
  }
  return agent === 'claude'
    ? leadPaneStateOf(foreground) === 'running'
    : recognizeAgentProcess(foreground)?.agent === agent
}

/** Another pane whose agent runs this conversation in the foreground now. */
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
    if (
      ptyId &&
      ptyId !== ask.ptyId &&
      foregroundRunsAgent(ask.agent, await deps.foregroundOf(ptyId).catch(() => null))
    ) {
      return one.paneKey
    }
  }
  return null
}

// Why: a resumed agent reaches the foreground only after its spawn and startup.
const CLAIM_STARTING_MS = 15_000
// Why: every caller settles its claim; this only bounds one a crashed caller left behind.
const CLAIM_PENDING_MAX_MS = 60_000

type RestoreClaim = {
  owner: string
  paneKey: string | null
  agent: string
  ptyId?: string
  at: number
  spawned: boolean
}

/** One resume per conversation at a time: two panes restored together must not both resume it. */
export class ConversationRestores {
  private readonly claims = new Map<string, RestoreClaim>()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: ConversationHolderDeps) {}

  /** The pane already holding the conversation, else a claim on it that the caller settles. */
  admit(ask: ConversationResume): Promise<RestoreAdmission> {
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
      .then(() => this.decide(key, owner, ask))
    this.queues.set(key, next)
    const prune = (): void => {
      if (this.queues.get(key) === next) {
        this.queues.delete(key)
      }
    }
    next.then(prune, prune)
    return next
  }

  private async decide(
    key: string,
    owner: string | null,
    ask: ConversationResume
  ): Promise<RestoreAdmission> {
    const claim = this.claims.get(key)
    if (claim && claim.owner !== owner) {
      if (await this.holds(claim)) {
        return { heldBy: claim.paneKey ?? claim.owner, settle: () => undefined }
      }
      if (this.claims.get(key) === claim) {
        this.claims.delete(key)
      }
    }
    const heldBy = await paneHoldingConversation(this.deps, ask)
    // Why no claim without an owner: nothing could tell its own retry from another pane.
    if (heldBy !== null || owner === null) {
      return heldBy === null ? NOT_CLAIMED : { heldBy, settle: () => undefined }
    }
    const mine: RestoreClaim = {
      owner,
      paneKey: ask.paneKey,
      agent: ask.agent,
      ...(ask.ptyId ? { ptyId: ask.ptyId } : {}),
      at: this.now(),
      spawned: false
    }
    this.claims.set(key, mine)
    return {
      heldBy: null,
      settle: (ptyId) => {
        if (this.claims.get(key) !== mine) {
          return
        }
        if (ptyId === null) {
          this.claims.delete(key)
          return
        }
        Object.assign(mine, { ptyId, at: this.now(), spawned: true })
      }
    }
  }

  private async holds(claim: RestoreClaim): Promise<boolean> {
    const age = this.now() - claim.at
    if (!claim.spawned) {
      return age < CLAIM_PENDING_MAX_MS
    }
    const ptyId = (claim.paneKey && this.deps.boundPtyIdOf(claim.paneKey)) || claim.ptyId
    const foreground = ptyId ? await this.deps.foregroundOf(ptyId).catch(() => null) : null
    // Why the starting window: the spawned pane shows its shell until the agent takes over.
    return (
      foregroundRunsAgent(claim.agent, foreground) ||
      (foreground !== null && age < CLAIM_STARTING_MS)
    )
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
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
