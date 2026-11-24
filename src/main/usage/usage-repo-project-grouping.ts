import type { Repo } from '../../shared/repo-types'

export type UsageRepoLabels = ReadonlyMap<string, string>

type ProjectRow = { projectKey: string; projectLabel: string; repoId: string | null }

export function getUsageRepoLabels(
  repos: Pick<Repo, 'id' | 'displayName' | 'connectionId'>[]
): UsageRepoLabels {
  const labels = new Map<string, string>()
  // Why: usage rows come from local transcripts only; a remote repo sharing the id must not rename them.
  for (const repo of repos) {
    if (!repo.connectionId && !labels.has(repo.id)) {
      labels.set(repo.id, repo.displayName)
    }
  }
  return labels
}

// Why: rows are stored per worktree; "By project" means per repo, so regroup at
// report time instead of migrating cached usage. Turns outside any repo keep their cwd key.
export function groupProjectRowsByRepo<T extends ProjectRow>(
  rows: T[],
  labels: UsageRepoLabels
): T[] {
  // A removed repo has no current name: its first row's label stands for all, in lists and "Top".
  const fallbackLabels = new Map<string, string>()
  return rows.map((row) => {
    if (!row.repoId) {
      return row
    }
    let projectLabel = labels.get(row.repoId) ?? fallbackLabels.get(row.repoId)
    if (projectLabel === undefined) {
      projectLabel = row.projectLabel
      fallbackLabels.set(row.repoId, projectLabel)
    }
    return { ...row, projectKey: `repo:${row.repoId}`, projectLabel }
  })
}

export function getRepoLocationKey(location: {
  locationKey: string
  repoId: string | null
}): string {
  return location.repoId ? `repo:${location.repoId}` : location.locationKey
}
