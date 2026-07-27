export type ClaudePtySpawnOptions = {
  persistenceAlreadyRecorded?: boolean
  credentialLocation?: 'local' | 'remote'
}

export function shouldTrackClaudePtyCredentials(options?: ClaudePtySpawnOptions): boolean {
  // Remote chains are unknowable locally; their host must protect them without freezing local rotation.
  return options?.credentialLocation !== 'remote'
}
