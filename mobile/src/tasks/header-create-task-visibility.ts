export type HeaderCreateTaskScope = {
  provider: string
  githubMode: 'items' | 'project'
}

/** Which providers get the header `+`. Plane was left out of the inline condition (ORCA-463). */
export function resolveHeaderCreateTask({ provider, githubMode }: HeaderCreateTaskScope): boolean {
  return (
    provider === 'linear' ||
    provider === 'plane' ||
    (provider === 'github' && githubMode === 'items')
  )
}
