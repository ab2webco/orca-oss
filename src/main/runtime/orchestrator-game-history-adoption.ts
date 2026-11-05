import type { GameHistoryAdoption } from '../../shared/orchestrator-game-log-adoption'
import type { GameStop } from '../../shared/orchestrator-game-stop-state'

type AdoptingStores = {
  history: { adopt: (from: string, to: string) => Promise<GameHistoryAdoption['history']> }
  lessons: { adopt: (from: string, to: string) => Promise<number | null> }
  stops: { adopt: (from: string, to: string) => Promise<GameStop | null> }
}

/**
 * Folds the game data a removed repo id left behind into the project's current key (ORCA-1011).
 * Saved members, the lead's conversation and drops stay: they name worktrees of the old repo id.
 */
export async function adoptGameProjectHistory(args: {
  fromRepoId: string
  toKey: string
  repoExists: (repoId: string) => boolean
  liveLeadOf: (projectKey: string) => Promise<string | null>
  liveMembersOf: (projectKey: string) => Promise<string[]>
  stores: AdoptingStores
}): Promise<GameHistoryAdoption> {
  const repoId = args.fromRepoId.trim()
  const from = `repo:${repoId}`
  if (!repoId || /\s/.test(repoId)) {
    throw new Error('--from-repo-id needs the removed repo id, such as 8e9e530d-….')
  }
  if (!args.toKey.startsWith('repo:')) {
    throw new Error("Run it from an Orca terminal in the project's repo, so its key is known.")
  }
  if (from === args.toKey) {
    throw new Error(`${repoId} is this project's own repo id; there is nothing to adopt.`)
  }
  // Why: a repo still in Orca owns its data, and adopting it would merge two live projects.
  if (args.repoExists(repoId)) {
    throw new Error(`Repo ${repoId} is still in Orca, so its game data is not orphaned.`)
  }
  for (const key of [args.toKey, from]) {
    const lead = await args.liveLeadOf(key)
    if (lead) {
      throw new Error(`A lead of this project is live (${lead}). Close it, then adopt.`)
    }
    const members = await args.liveMembersOf(key)
    if (members.length > 0) {
      throw new Error(`Members of this project are live (${members.join(', ')}). Free them first.`)
    }
  }
  return {
    from,
    to: args.toKey,
    history: await args.stores.history.adopt(from, args.toKey),
    lessons: await args.stores.lessons.adopt(from, args.toKey),
    stop: await args.stores.stops.adopt(from, args.toKey)
  }
}
