import { isFolderRepo } from '../../shared/repo-kind'
import type { Repo } from '../../shared/repo-types'
import {
  splitWorktreeId,
  splitWorktreeIdForFilesystem,
  WORKTREE_ID_SEPARATOR
} from '../../shared/worktree/id'
import type { RuntimeWorktreeScanResult } from './repo-worktree-resolution-scan'

type Deps = {
  reposWithId: (repoId: string) => Repo[]
  scan: (repo: Repo) => Promise<RuntimeWorktreeScanResult>
  /** Whether a local path is there; without it a folder workspace is never judged. */
  pathExists?: (path: string) => Promise<boolean>
}

/**
 * Whether a paused member's saved worktree is known to be gone (ORCA-832). Only a scan that answered
 * counts: an unreachable SSH host or an ambiguous repo never reads as gone. A folder workspace is
 * gone when its local folder is; one on an SSH host is never judged.
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
  if (owners.length > 1) {
    return false
  }
  if (isFolderRepo(repo)) {
    const folder = splitWorktreeIdForFilesystem(worktreeId)?.worktreePath
    return !repo.connectionId && folder && deps.pathExists
      ? !(await deps.pathExists(folder))
      : false
  }
  const scan = await deps.scan(repo)
  return (
    scan.ok &&
    !scan.worktrees.some((one) => `${repo.id}${WORKTREE_ID_SEPARATOR}${one.path}` === worktreeId)
  )
}
