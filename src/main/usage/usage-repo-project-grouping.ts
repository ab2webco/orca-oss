import type { Repo } from '../../shared/repo-types'

export type UsageRepoLabels = ReadonlyMap<string, string>

type ProjectRow = { projectKey: string; projectLabel: string; repoId: string | null }

export function getUsageRepoLabels(repos: Pick<Repo, 'id' | 'displayName'>[]): UsageRepoLabels {
  return new Map(repos.map((repo) => [repo.id, repo.displayName]))
}

// Why: rows are stored per worktree; "By project" means per repo, so regroup at
// report time instead of migrating cached usage. Turns outside any repo keep their cwd key.
export function groupProjectRowsByRepo<T extends ProjectRow>(
  rows: T[],
  labels: UsageRepoLabels
): T[] {
  return rows.map((row) =>
    row.repoId
      ? {
          ...row,
          projectKey: `repo:${row.repoId}`,
          projectLabel: labels.get(row.repoId) ?? row.projectLabel
        }
      : row
  )
}

export function getRepoLocationKey(location: {
  locationKey: string
  repoId: string | null
}): string {
  return location.repoId ? `repo:${location.repoId}` : location.locationKey
}
