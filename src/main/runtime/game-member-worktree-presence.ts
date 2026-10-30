import { isFolderRepo } from '../../shared/repo-kind'
import type { Repo } from '../../shared/repo-types'
import { splitWorktreeId, WORKTREE_ID_SEPARATOR } from '../../shared/worktree/id'
import type { RuntimeWorktreeScanResult } from './repo-worktree-resolution-scan'

type Deps = {
  reposWithId: (repoId: string) => Repo[]
  scan: (repo: Repo) => Promise<RuntimeWorktreeScanResult>
}

/**
 * Whether a paused member's saved worktree is known to be gone (ORCA-832). Only a scan that answered
 * counts: an unreachable SSH host, an ambiguous repo or a folder workspace never reads as gone.
 */
export async function isGameMemberWorktreeGone(worktreeId: string, deps: Deps): Promise<boolean> {
  const parsed = splitWorktreeId(worktreeId)
  if (!parsed) {
    return false
  }
  const owners = deps.reposWithId(parsed.repoId)
  if (owners.length === 0) {
    return true
  }
  const repo = owners[0]
  if (owners.length > 1 || isFolderRepo(repo)) {
    return false
  }
  const scan = await deps.scan(repo)
  return (
    scan.ok &&
    !scan.worktrees.some((one) => `${repo.id}${WORKTREE_ID_SEPARATOR}${one.path}` === worktreeId)
  )
}
