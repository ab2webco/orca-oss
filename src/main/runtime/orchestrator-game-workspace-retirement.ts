import { WORKTREE_ID_SEPARATOR, splitWorktreeId } from '../../shared/worktree/id'
import type { GameMemberSession } from '../../shared/orchestrator-game-member-sessions'
import type {
  MemberDispatchState,
  RemovedWorkspace
} from './orchestration/removed-workspace-workers'
import type { GameMemberSessionStore } from './orchestrator-game-member-session-store'
import type { GameDroppedAgentStore } from './orchestrator-game-dropped-agent-store'

export type GameWorkspaceRetired = {
  /** Dispatches settled on this machine. */
  settled: string[]
  /** Saved members forgotten, as `<project key> <ticket>`. */
  members: string[]
  drops: number
  /** What could not be cleared; the rest still was. */
  errors: string[]
}

/** What this machine knows of a saved member's dispatch; null when it knows none. */
export type GameMemberDispatchState = MemberDispatchState

type Deps = {
  /** Every project whose game files may name the removed workspace: members run under their lead's. */
  projectKeys: () => readonly string[]
  members: Pick<GameMemberSessionStore, 'removeWhere'>
  drops: Pick<GameDroppedAgentStore, 'forgetWorktrees'>
  /** Null when there is no orchestration database on this machine yet. */
  settleWorkers: (removal: RemovedWorkspace) => string[] | null
  dispatchOf: (dispatchId: string) => GameMemberDispatchState | null
  /** For one host's copy: the repo's worktrees used on that host alone; null without a database. */
  hostWorktrees: (removal: RemovedWorkspace) => ReadonlySet<string> | null
}

/**
 * Deleting a worktree, folder workspace or repo settles and forgets its members (ORCA-1478): its live
 * dispatches here, its saved members and its drops, matched by workspace and never by ticket, so a
 * member in another worktree with the same ticket stays. A removed repo's own project is emptied.
 * One host's copy of a shared repo retires only the members that ran on that host, and its project
 * stays for the other copy (ORCA-1491).
 */
export async function retireRemovedGameWorkspace(
  deps: Deps,
  removal: RemovedWorkspace
): Promise<GameWorkspaceRetired> {
  const retired: GameWorkspaceRetired = { settled: [], members: [], drops: 0, errors: [] }
  const hostId = 'repoId' in removal ? (removal.hostId ?? null) : null
  const inWorkspace =
    'repoId' in removal
      ? (id: string | null) => !!id?.startsWith(`${removal.repoId}${WORKTREE_ID_SEPARATOR}`)
      : (id: string | null) => id === removal.worktreeId
  const ownKey = 'repoId' in removal && hostId === null ? `repo:${removal.repoId}` : null
  let hostWorktrees: ReadonlySet<string> = new Set()
  if (hostId !== null) {
    try {
      hostWorktrees = deps.hostWorktrees(removal) ?? hostWorktrees
    } catch (error) {
      retired.errors.push(`host worktrees: ${String(error)}`)
    }
  }
  // Why only what a dispatch places there: a worktree id names no host, so a drop or record the
  // removed host cannot be proven to hold stays for the copy that may still use it.
  const removed =
    hostId === null ? inWorkspace : (id: string | null) => !!id && hostWorktrees.has(id)
  const onRemovedHost = (one: GameMemberSession): boolean =>
    hostId === null || (!!one.dispatchId && deps.dispatchOf(one.dispatchId)?.hostId === hostId)
  try {
    retired.settled = deps.settleWorkers(removal) ?? []
  } catch (error) {
    retired.errors.push(`dispatches: ${String(error)}`)
  }
  // Why kept: a member still running elsewhere, or a paired host's member whose worktree id reads
  // the same, still resumes from its record; only an emptied project lets a paired host's go.
  const kept = (one: GameMemberSession, own: boolean): boolean => {
    const dispatch = one.dispatchId ? deps.dispatchOf(one.dispatchId) : null
    return !!dispatch && (dispatch.live || (dispatch.pairedHost && !own))
  }
  const repoId = 'repoId' in removal ? removal.repoId : splitWorktreeId(removal.worktreeId)?.repoId
  for (const key of new Set([...(repoId ? [`repo:${repoId}`] : []), ...deps.projectKeys()])) {
    const own = key === ownKey
    try {
      const tickets = await deps.members.removeWhere(
        key,
        (one) => (own || (inWorkspace(one.worktreeId) && onRemovedHost(one))) && !kept(one, own)
      )
      retired.members.push(...tickets.map((ticket) => `${key} ${ticket}`))
    } catch (error) {
      retired.errors.push(`members of ${key}: ${String(error)}`)
    }
    try {
      retired.drops += await deps.drops.forgetWorktrees(key, removed, own)
    } catch (error) {
      retired.errors.push(`drops of ${key}: ${String(error)}`)
    }
  }
  return retired
}
