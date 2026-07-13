import type { IPtyProvider, PtySpawnOptions, PtySpawnResult } from './types'
import { requiredPtyReattachUnavailableMessage } from './pty-reattach-contract'

async function providerOwnsSession(provider: IPtyProvider, sessionId: string): Promise<boolean> {
  return (await provider.listProcesses()).some((session) => session.id === sessionId)
}

export async function spawnRequiredPtyReattach<T extends IPtyProvider>(
  opts: PtySpawnOptions,
  mappedProvider: T | undefined,
  candidates: T[],
  sessionProviders: Map<string, T>
): Promise<PtySpawnResult> {
  if (!opts.requireReattach || !opts.sessionId) {
    throw new Error('Required PTY reattach routing needs an explicit session id')
  }
  const sessionId = opts.sessionId
  const providers = [...new Set(mappedProvider ? [mappedProvider, ...candidates] : candidates)]
  const providersToProbe = mappedProvider
    ? providers.filter((provider) => provider !== mappedProvider)
    : providers
  const ownership = await Promise.all(
    providersToProbe.map(async (provider) => ({
      provider,
      ownsSession: await providerOwnsSession(provider, sessionId)
    }))
  )
  const discoveredOwners = ownership
    .filter(({ ownsSession }) => ownsSession)
    .map(({ provider }) => provider)
  if (mappedProvider && discoveredOwners.length > 0) {
    throw new Error(`PTY_REQUIRED_REATTACH_OWNER_AMBIGUOUS: ${sessionId}`)
  }
  if (!mappedProvider && discoveredOwners.length !== 1) {
    if (discoveredOwners.length > 1) {
      throw new Error(`PTY_REQUIRED_REATTACH_OWNER_AMBIGUOUS: ${sessionId}`)
    }
    throw new Error(requiredPtyReattachUnavailableMessage(sessionId))
  }
  const owner = mappedProvider ?? discoveredOwners[0]
  if (!owner) {
    throw new Error(requiredPtyReattachUnavailableMessage(sessionId))
  }
  const result = await owner.spawn(opts)
  sessionProviders.set(result.id, owner)
  return result
}
