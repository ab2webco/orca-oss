import type { GameRepoSummary } from '../../shared/orchestrator-game-member-repo-scope'
import type { Repo } from '../../shared/repo-types'
import { detectGitOwnRemoteKey } from '../repo-git-remote-identity'

export type GameRepoRecord = Pick<
  Repo,
  'id' | 'displayName' | 'path' | 'gitRemoteIdentity' | 'connectionId' | 'kind'
>

const namesUpstream = (repo: GameRepoRecord): boolean =>
  repo.gitRemoteIdentity?.remoteName === 'upstream'

// Why null for upstream: a paired host's repo named by its upstream could be any fork of it (ORCA-1198).
export const gameRepoSummaryOf = (repo: GameRepoRecord): GameRepoSummary => {
  const remoteKey = repo.gitRemoteIdentity?.canonicalKey ?? null
  return {
    id: repo.id,
    displayName: repo.displayName,
    path: repo.path,
    remoteKey,
    ownRemoteKey: namesUpstream(repo) ? null : remoteKey,
    ...(repo.kind ? { kind: repo.kind } : {})
  }
}

/** A repo in this Orca's store, whose remotes it can read to find a fork's own. */
export const localGameRepoSummaryOf = async (repo: GameRepoRecord): Promise<GameRepoSummary> =>
  namesUpstream(repo)
    ? {
        ...gameRepoSummaryOf(repo),
        ownRemoteKey: await detectGitOwnRemoteKey(repo.path, repo.connectionId)
      }
    : gameRepoSummaryOf(repo)
