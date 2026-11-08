/** The dock's "New action" asks Settings > Actions to open its form once it mounts for that project. */
let pendingNewFor: string | null = null

export function requestNewGameAction(repoId: string): void {
  pendingNewFor = repoId
}

/** True once for the project the dock asked about; the request is spent either way. */
export function takeNewGameActionRequest(repoId: string): boolean {
  const asked = pendingNewFor === repoId
  if (asked) {
    pendingNewFor = null
  }
  return asked
}
