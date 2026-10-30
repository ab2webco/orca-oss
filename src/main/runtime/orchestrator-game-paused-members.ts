import type { AgentStatusOrchestrationContext } from '../../shared/agent-status-types'
import { ticketOfMember } from '../../shared/orchestrator-game-fleet-verbs'
import { finishedSignalOf } from '../../shared/orchestrator-game-member-finished'
import {
  pausedMembersOf,
  queuedMembersOf,
  type GameMemberSession,
  type GameMemberSessionPatch,
  type GamePausedCauseOf,
  type GamePausedMember,
  type GameQueuedMember,
  type GameSetupQueueEntry,
  type GameUnlistedMember,
  unlistedMembersOf
} from '../../shared/orchestrator-game-member-sessions'
import type { GameAgent } from '../../shared/orchestrator-game-state'
import type { GameMemberSessionStore } from './orchestrator-game-member-session-store'

export type GamePausedMembersView = {
  paused: GamePausedMember[]
  queued: GameQueuedMember[]
  unlisted: GameUnlistedMember[]
  error: string | null
}

type Deps = {
  store: GameMemberSessionStore
  contextOf: (terminalHandle: string) => AgentStatusOrchestrationContext | undefined
  /** The live agent's own conversation id, null until its hooks report one. */
  sessionIdOf: (terminalHandle: string) => string | null
  /** Why a saved member is not live while its terminal is open; null when the terminal is gone. */
  causeOf?: GamePausedCauseOf
  /** True only when its repo answered without it; an unreachable host is not gone. */
  worktreeGone?: (worktreeId: string) => Promise<boolean>
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message.replace(/^Members not saved: /, '') : String(error)

/** Keeps each project's members on disk while they run, so the lead finds them after a restart. */
export class GamePausedMembers {
  constructor(private readonly deps: Deps) {}

  /**
   * Saves what each live member needs to resume and returns the saved ones not live now. Never
   * throws: the game state it rides on must not fail on this.
   */
  async note(
    projectKey: string,
    agents: readonly GameAgent[],
    liveWorktreeIds: ReadonlySet<string> = new Set(),
    setup: { queued: readonly GameSetupQueueEntry[]; starting: readonly string[] } = {
      queued: [],
      starting: []
    }
  ): Promise<GamePausedMembersView> {
    const live = agents.flatMap((agent) => {
      const ticket = agent.isMember ? ticketOfMember(agent) : null
      return ticket ? [{ agent, ticket }] : []
    })
    let error: string | null = null
    try {
      // Why: a remote member has no local session to save or resume, but its launch record must not read as paused (ORCA-824, ORCA-864).
      await this.deps.store.upsert(
        projectKey,
        live
          .filter(({ agent }) => !agent.remote)
          .map(({ agent, ticket }) => this.patchOf(agent, ticket))
      )
    } catch (failure) {
      error = errorText(failure)
    }
    const read = await this.deps.store.read(projectKey)
    if (!read.ok) {
      return { paused: [], queued: [], unlisted: [], error: read.reason }
    }
    const tickets = new Set(live.map((one) => one.ticket))
    const starting = new Set([...setup.starting, ...setup.queued.map((entry) => entry.taskId)])
    const liveNow = { tickets, worktreeIds: liveWorktreeIds }
    const gone = await this.goneWorktreesOf(read.members.filter((one) => !tickets.has(one.ticket)))
    return {
      paused: pausedMembersOf(read.members, liveNow, starting, this.deps.causeOf, gone),
      unlisted: unlistedMembersOf(read.members, liveNow, starting),
      queued: queuedMembersOf(read.members, setup.queued),
      error
    }
  }

  /** A launch, recorded before its agent runs so a launch cut short is still found. */
  async record(projectKey: string, patch: GameMemberSessionPatch): Promise<void> {
    await this.deps.store.upsert(projectKey, patch)
  }

  async forget(projectKey: string, tickets: readonly string[]): Promise<void> {
    await this.deps.store.remove(projectKey, tickets)
  }

  private async goneWorktreesOf(members: readonly GameMemberSession[]): Promise<Set<string>> {
    const worktreeGone = this.deps.worktreeGone
    if (!worktreeGone) {
      return new Set()
    }
    const ids = new Set(
      members.flatMap((one) =>
        one.worktreeId !== null && one.lastState !== 'finished' ? [one.worktreeId] : []
      )
    )
    const gone = await Promise.all(
      [...ids].map(async (id) => ((await worktreeGone(id).catch(() => false)) ? [id] : []))
    )
    return new Set(gone.flat())
  }

  private patchOf(agent: GameAgent, ticket: string): GameMemberSessionPatch {
    const handle = agent.terminalHandle
    const context = handle ? this.deps.contextOf(handle) : undefined
    const sessionId = handle ? this.deps.sessionIdOf(handle) : null
    // Why: done work is never resumed, busy or not; a completed dispatch's worker_done succeeded.
    const finished = finishedSignalOf(agent) !== null || context?.dispatchStatus === 'completed'
    return {
      ticket,
      name: agent.displayName,
      ...(context?.orchestrationRunId
        ? {
            runId: context.orchestrationRunId,
            taskId: context.taskId,
            dispatchId: context.dispatchId
          }
        : {}),
      ...(agent.worktree ? { worktreeId: agent.worktree.id, branch: agent.worktree.branch } : {}),
      agent: agent.agentType,
      ...(agent.account ? { accountId: agent.account.id, account: agent.account.email } : {}),
      ...(sessionId ? { sessionId } : {}),
      lastState: finished ? 'finished' : agent.state
    }
  }
}
