import type { GlobalSettings } from '../../shared/global-settings-types'
import type { Repo } from '../../shared/repo-types'
import { isFolderRepo } from '../../shared/repo-kind'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree/id'
import { computeWorktreePathAsync, getWorktreePathSettings } from '../ipc/worktree-logic'
import { normalizeComparablePath } from './usage-path-comparison'
import type { UsageScanWorktreeRef } from './usage-provider-contract'

const WORKSPACE_ROOT_PROBE = 'orca-usage-probe'

type WorkspacePathSettings = Pick<GlobalSettings, 'workspaceDir' | 'nestWorkspaces'>

/** Why: Orca deletes ticket worktrees after merge, so a rescan must still credit their usage to the
 *  repo. A cwd under a repo's own workspace folder belongs to it even when the worktree is gone.
 *  A folder shared by several repos (flat layout, same basename) is ambiguous and skipped. */
export async function getRepoWorkspaceRootRefs(
  repos: Repo[],
  settings: WorkspacePathSettings | null
): Promise<UsageScanWorktreeRef[]> {
  if (!settings?.workspaceDir) {
    return []
  }
  const reposByRoot = new Map<string, { root: string; repos: Repo[] }>()
  for (const repo of repos) {
    if (repo.connectionId || isFolderRepo(repo)) {
      continue
    }
    try {
      const probe = await computeWorktreePathAsync(
        WORKSPACE_ROOT_PROBE,
        repo.path,
        getWorktreePathSettings(repo, settings)
      )
      const root = probe.slice(0, -(WORKSPACE_ROOT_PROBE.length + 1))
      const key = normalizeComparablePath(root)
      const entry = reposByRoot.get(key) ?? { root, repos: [] }
      entry.repos.push(repo)
      reposByRoot.set(key, entry)
    } catch {
      // A repo whose workspace root cannot be resolved keeps cwd attribution.
    }
  }
  const refs: UsageScanWorktreeRef[] = []
  for (const { root, repos: owners } of reposByRoot.values()) {
    if (owners.length !== 1) {
      continue
    }
    const repo = owners[0]!
    refs.push({
      repoId: repo.id,
      worktreeId: `${repo.id}::${root}`,
      path: root,
      displayName: repo.displayName
    })
  }
  return refs
}

type AttributedRow = { repoId: unknown; worktreeId: unknown; projectLabel: unknown }

/** Worktrees the previous scan attributed but that are no longer known, so a rescan triggered by
 *  the worktree set changing does not demote their usage to cwd rows. */
export function getPreviouslyAttributedWorktreeRefs(
  previousDailyRows: readonly unknown[],
  repos: Repo[],
  currentRefs: readonly UsageScanWorktreeRef[]
): UsageScanWorktreeRef[] {
  const localRepoIds = new Set(repos.filter((repo) => !repo.connectionId).map((repo) => repo.id))
  const known = new Set(currentRefs.map((ref) => ref.worktreeId))
  const refs: UsageScanWorktreeRef[] = []
  for (const row of previousDailyRows as AttributedRow[]) {
    const { repoId, worktreeId, projectLabel } = row ?? ({} as AttributedRow)
    if (typeof repoId !== 'string' || typeof worktreeId !== 'string') {
      continue
    }
    if (!localRepoIds.has(repoId) || known.has(worktreeId)) {
      continue
    }
    const path = splitWorktreeIdForFilesystem(worktreeId)?.worktreePath
    if (!path) {
      continue
    }
    known.add(worktreeId)
    refs.push({
      repoId,
      worktreeId,
      path,
      displayName: typeof projectLabel === 'string' ? projectLabel : path
    })
  }
  return refs
}
