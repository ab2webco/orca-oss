import { isSafePtySessionId, mintPtySessionId } from '../daemon/pty-session-id'

/**
 * Mints the daemon session-id shape for a fresh PTY that the degraded daemon
 * routes to the local provider (ORCA-114).
 *
 * Why: `LocalPtyProvider` allocates process-local numeric ids, so while
 * `degraded-new-pty-fallback` is active every consumer that recovers the owning
 * worktree from the id — Claude account blocker messages, memory attribution,
 * the `${worktreeId}@@` teardown sweep — loses attribution. Reusing
 * `mintPtySessionId` keeps a single format instead of inventing a second one.
 *
 * Returns undefined when there is nothing to attribute (no `worktreeId`: the
 * documented bare-UUID case) or when the id would not be a safe filesystem key,
 * leaving the provider free to allocate its own id rather than failing a spawn
 * that used to succeed.
 *
 * Note: a `worktreeId` that is not `${repoId}::${path}` (the global floating
 * terminal) still yields an id `parsePtySessionId` rejects — same as the daemon
 * path mints today, so degraded and healthy spawns stay identical.
 */
export function mintLocalFallbackPtySessionId(
  worktreeId: string | undefined,
  userDataPath: string
): string | undefined {
  const trimmed = worktreeId?.trim()
  if (!trimmed) {
    return undefined
  }
  const sessionId = mintPtySessionId(trimmed, { localFallback: true })
  return isSafePtySessionId(sessionId, userDataPath) ? sessionId : undefined
}
