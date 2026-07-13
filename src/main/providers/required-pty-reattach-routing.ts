import type { IPtyProvider, PtySpawnOptions, PtySpawnResult } from './types'
import { isRequiredPtyReattachUnavailable } from './pty-reattach-contract'

export async function spawnRequiredPtyReattach<T extends IPtyProvider>(
  opts: PtySpawnOptions,
  mappedProvider: T | undefined,
  candidates: T[],
  sessionProviders: Map<string, T>
): Promise<PtySpawnResult> {
  if (!opts.requireReattach || !opts.sessionId) {
    throw new Error('Required PTY reattach routing needs an explicit session id')
  }
  let unavailableError: unknown
  for (const provider of new Set(mappedProvider ? [mappedProvider, ...candidates] : candidates)) {
    try {
      const result = await provider.spawn(opts)
      sessionProviders.set(result.id, provider)
      return result
    } catch (error) {
      if (!isRequiredPtyReattachUnavailable(error)) {
        // Why: a transient or non-atomic legacy result cannot prove that no
        // other provider still owns the credential-bound process.
        throw error
      }
      unavailableError = error
    }
  }
  throw unavailableError ?? new Error('No PTY provider could verify the preserved session')
}
