import {
  LOCAL_EXECUTION_HOST_ID,
  getRepoExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import { WORKTREE_ID_SEPARATOR } from '../../shared/pty-session-id-format'
import { isFolderRepo } from '../../shared/repo-kind'
import type { Repo } from '../../shared/repo-types'

// Why: this runtime runs git and fs on its own disk, so `local` and every `runtime:` stamp (a paired
// client's name for this host) describe the same tree; only an SSH host is another disk.
export function toRuntimeDiskHostId(hostId: ExecutionHostId): ExecutionHostId {
  return parseExecutionHostId(hostId)?.kind === 'ssh' ? hostId : LOCAL_EXECUTION_HOST_ID
}

type WorktreeRecord = { repoId: string; path: string }

/**
 * Collapses records that different repos keep for one worktree on one disk, keeping the host-owned
 * (`local`) one. Records of the same repo stay apart: folder workspaces share a path by design.
 */
export function collapseSameDiskWorktreeRecords<T extends WorktreeRecord>(
  records: readonly T[],
  getHostId: (record: T) => ExecutionHostId,
  pathKey: (path: string) => string
): T[] {
  const keptByLocation = new Map<string, T[]>()
  const kept: T[] = []
  for (const record of records) {
    const hostId = getHostId(record)
    const locationKey = `${toRuntimeDiskHostId(hostId)}\0${pathKey(record.path)}`
    const group = keptByLocation.get(locationKey) ?? []
    const duplicate = group.find((other) => other.repoId !== record.repoId)
    if (!duplicate) {
      group.push(record)
      keptByLocation.set(locationKey, group)
      kept.push(record)
      continue
    }
    if (hostId === LOCAL_EXECUTION_HOST_ID && getHostId(duplicate) !== LOCAL_EXECUTION_HOST_ID) {
      group[group.indexOf(duplicate)] = record
      kept[kept.indexOf(duplicate)] = record
    }
  }
  return kept
}

type RepoIdentity = Pick<Repo, 'id' | 'path' | 'kind' | 'connectionId' | 'executionHostId'>

/** Ids other repo records on the same disk give the worktree at `worktreePath` of `repo`. */
export function findSameDiskSiblingWorktreeIds(
  repo: RepoIdentity,
  worktreePath: string,
  repos: readonly RepoIdentity[],
  pathKey: (path: string) => string
): { repoId: string; worktreeId: string }[] {
  const diskHostId = toRuntimeDiskHostId(getRepoExecutionHostId(repo))
  const repoPathKey = pathKey(repo.path)
  return repos
    .filter(
      (other) =>
        other.id !== repo.id &&
        !isFolderRepo(other) &&
        pathKey(other.path) === repoPathKey &&
        toRuntimeDiskHostId(getRepoExecutionHostId(other)) === diskHostId
    )
    .map((other) => ({
      repoId: other.id,
      worktreeId: `${other.id}${WORKTREE_ID_SEPARATOR}${worktreePath}`
    }))
}
