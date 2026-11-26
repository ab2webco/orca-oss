import { WORKTREE_ID_SEPARATOR, splitWorktreeId } from '../../shared/worktree/id'
import type { RemovedWorkspace } from './orchestration/removed-workspace-workers'
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

type Deps = {
  /** Every project whose game files may name the removed workspace: members run under their lead's. */
  projectKeys: () => readonly string[]
  members: Pick<GameMemberSessionStore, 'removeInWorktrees'>
  drops: Pick<GameDroppedAgentStore, 'forgetWorktrees'>
  /** Null when there is no orchestration database on this machine yet. */
  settleWorkers: (removal: RemovedWorkspace) => string[] | null
}

/**
 * Deleting a worktree, folder workspace or repo settles and forgets its members (ORCA-1478): its live
 * dispatches here, its saved members and its drops, matched by workspace and never by ticket, so a
 * member in another worktree with the same ticket stays. A removed repo's own project is emptied.
 */
export async function retireRemovedGameWorkspace(
  deps: Deps,
  removal: RemovedWorkspace
): Promise<GameWorkspaceRetired> {
  const retired: GameWorkspaceRetired = { settled: [], members: [], drops: 0, errors: [] }
  const removed =
    'repoId' in removal
      ? (id: string | null) => !!id?.startsWith(`${removal.repoId}${WORKTREE_ID_SEPARATOR}`)
      : (id: string | null) => id === removal.worktreeId
  const ownKey = 'repoId' in removal ? `repo:${removal.repoId}` : null
  try {
    retired.settled = deps.settleWorkers(removal) ?? []
  } catch (error) {
    retired.errors.push(`dispatches: ${String(error)}`)
  }
  const repoId = 'repoId' in removal ? removal.repoId : splitWorktreeId(removal.worktreeId)?.repoId
  for (const key of new Set([...(repoId ? [`repo:${repoId}`] : []), ...deps.projectKeys()])) {
    const own = key === ownKey
    try {
      const tickets = await deps.members.removeInWorktrees(key, own ? () => true : removed)
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
