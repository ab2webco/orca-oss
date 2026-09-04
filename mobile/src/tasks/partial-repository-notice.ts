export function repositoryCount(count: number): string {
  return `${count} ${count === 1 ? 'repository' : 'repositories'}`
}

export function buildPartialRepositoryNotice(failedCount: number, totalCount: number): string {
  return `${failedCount} of ${repositoryCount(totalCount)} failed to load.`
}

/** Why: a partial load is exactly when the per-repo Retry banners matter, so it must not hide them. */
export function taskNoticeBannersVisible(state: {
  error: string
  partialRepositoryNotice: string
}): boolean {
  return state.error === ''
}
