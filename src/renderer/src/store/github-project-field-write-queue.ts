type GitHubProjectFieldWriteIdentity = {
  cacheKey: string
  rowId: string
  fieldId: string
}

const writeTails = new Map<string, Promise<void>>()

function writeKey(identity: GitHubProjectFieldWriteIdentity): string {
  return JSON.stringify([identity.cacheKey, identity.rowId, identity.fieldId])
}

export function enqueueGitHubProjectFieldWrite<T>(
  identity: GitHubProjectFieldWriteIdentity,
  write: () => Promise<T>
): Promise<T> {
  const key = writeKey(identity)
  const previous = writeTails.get(key) ?? Promise.resolve()
  const result = previous.then(write, write)
  const tail = result.then(
    () => undefined,
    () => undefined
  )
  writeTails.set(key, tail)
  void tail.then(() => {
    if (writeTails.get(key) === tail) {
      writeTails.delete(key)
    }
  })
  return result
}
