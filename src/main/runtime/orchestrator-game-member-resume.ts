import type {
  GameMemberResumeOutcome,
  GameMemberResumeTarget,
  GameMemberSession
} from '../../shared/orchestrator-game-member-sessions'
import type { GameMemberSessionStore } from './orchestrator-game-member-session-store'

type Deps = {
  store: GameMemberSessionStore
  /** The task's status and its latest dispatch's, from orchestration; null when it is gone. */
  statusOf: (taskId: string) => {
    task: string | null
    latestDispatch: string | null
    latestDispatchId: string | null
  }
  /** The worktree the task's newest worker got, for a launch cut short before it was saved. */
  worktreeOfTask: (taskId: string) => string | null
  worktreeExists: (worktreeId: string) => Promise<boolean>
  /** Reopens the member's own conversation and returns its terminal once the agent runs; throws when it cannot. */
  resumeSession: (member: GameMemberSession) => Promise<string>
  now?: () => number
}

const targetOf = (member: GameMemberSession, retryOf: string | null): GameMemberResumeTarget => ({
  ticket: member.ticket,
  name: member.name,
  runId: member.runId,
  taskId: member.taskId,
  worktreeId: member.worktreeId,
  agent: member.agent,
  accountId: member.accountId,
  account: member.account,
  ...(retryOf ? { retryOf } : {})
})

// Why: worker-start takes a ready task, or a failed or blocked one as a retry of its latest dispatch.
const RETRIED = new Set(['failed', 'blocked'])
// Why: the CLI binds the resumed member's dispatch after this returns; until then its task still reads ready.
const RESUME_CLAIM_MS = 120_000

/** Brings one saved member back after a restart, or frees the ones the person does not want back. */
export class GameMemberResume {
  /** When each project's ticket was claimed; a second lead's call in that window must not reopen it again. */
  private readonly claims = new Map<string, number>()

  constructor(private readonly deps: Deps) {}

  async resume(projectKey: string, rawTicket: string): Promise<GameMemberResumeOutcome> {
    const ticket = rawTicket.toUpperCase()
    const key = `${projectKey}\u0000${ticket}`
    const now = (this.deps.now ?? Date.now)()
    const claimedAt = this.claims.get(key)
    if (claimedAt !== undefined && now - claimedAt < RESUME_CLAIM_MS) {
      return {
        outcome: 'missing',
        ticket,
        reason: `${ticket} is already being resumed by another call; run game fleet in a minute`
      }
    }
    this.claims.set(key, now)
    const outcome = await this.resumeClaimed(projectKey, ticket).catch((error: unknown) => {
      this.claims.delete(key)
      throw error
    })
    if (outcome.outcome !== 'resumed' && outcome.outcome !== 'relaunch') {
      this.claims.delete(key)
    }
    return outcome
  }

  private async resumeClaimed(
    projectKey: string,
    ticket: string
  ): Promise<GameMemberResumeOutcome> {
    const read = await this.deps.store.read(projectKey)
    if (!read.ok) {
      return { outcome: 'missing', ticket, reason: read.reason }
    }
    const saved = read.members.find((one) => one.ticket === ticket)
    if (!saved) {
      return { outcome: 'missing', ticket, reason: `no saved member holds ${ticket}` }
    }
    const member = {
      ...saved,
      worktreeId: saved.worktreeId ?? this.deps.worktreeOfTask(saved.taskId)
    }
    const status = this.deps.statusOf(member.taskId)
    if (status.task === 'completed' || status.latestDispatch === 'completed') {
      await this.deps.store.remove(projectKey, [ticket])
      return { outcome: 'finished', ticket }
    }
    if (status.task === null) {
      return {
        outcome: 'missing',
        ticket,
        reason: `its orchestration task ${member.taskId} is gone`
      }
    }
    const retryOf = RETRIED.has(status.task) ? status.latestDispatchId : null
    if (status.task !== 'ready' && !retryOf) {
      return {
        outcome: 'missing',
        ticket,
        reason: `its task ${member.taskId} is still marked ${status.task} by ${status.latestDispatchId ?? 'an older dispatch'}, so no new member can take it`
      }
    }
    if (member.worktreeId !== null && !(await this.deps.worktreeExists(member.worktreeId))) {
      return {
        outcome: 'missing',
        ticket,
        reason: `its worktree ${member.branch ?? member.worktreeId} is gone; \`orca game resume-members ${ticket} --discard\` frees it`
      }
    }
    // Why Claude only: its session id is what Orca's hooks report; other agents restart on their task.
    if (member.worktreeId === null || member.sessionId === null || member.agent !== 'claude') {
      return { outcome: 'relaunch', member: targetOf(member, retryOf) }
    }
    try {
      const terminal = await this.deps.resumeSession(member)
      return { outcome: 'resumed', terminal, member: targetOf(member, retryOf) }
    } catch (error) {
      // Why relaunch: the worktree keeps the work even when the conversation cannot reopen.
      const note = error instanceof Error ? error.message : String(error)
      return { outcome: 'relaunch', member: targetOf(member, retryOf), note }
    }
  }

  /**
   * Frees saved members. `all` on a file this Orca cannot read sets it aside, bytes kept, so the
   * project starts a new record; naming tickets on such a file fails, since none can be found.
   */
  async discard(
    projectKey: string,
    tickets: readonly string[] | 'all'
  ): Promise<{ discarded: string[]; setAside: string | null }> {
    const read = await this.deps.store.read(projectKey)
    if (!read.ok) {
      if (tickets !== 'all') {
        throw new Error(read.reason)
      }
      return { discarded: [], setAside: await this.deps.store.setAside(projectKey) }
    }
    const named = tickets === 'all' ? null : new Set(tickets.map((one) => one.toUpperCase()))
    const discarded = read.members
      .map((one) => one.ticket)
      .filter((ticket) => !named || named.has(ticket))
    await this.deps.store.remove(projectKey, discarded)
    return { discarded, setAside: null }
  }
}
