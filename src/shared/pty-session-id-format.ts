/**
 * Shared helpers for the minted PTY session id format.
 *
 * Why split out of `src/main/daemon/pty-session-id.ts`: the renderer-side
 * merge in `mergeSnapshotAndSessions.ts` and the boot-time hydration in
 * `attach-main-window-services.ts` both need to recover the owning
 * worktreeId from a session id. Three call sites silently re-implementing
 * the same parser (one of them looser than the others) was the seed of
 * the resource-usage REMOTE-mislabel bug. Centralising the format here
 * keeps a single definition that both the main process and the renderer
 * can import.
 */

export const PTY_SESSION_ID_SEPARATOR = '@@'
export const WORKTREE_ID_SEPARATOR = '::'

/**
 * Suffix marker for ids minted for a PTY the degraded daemon routes to the
 * local provider (ORCA-114). It sits in the half AFTER the separator, so every
 * consumer that recovers the worktreeId from the prefix is unaffected.
 *
 * Why a marker at all: those PTYs are worktree-attributable but have no daemon
 * session model, so consumers that read `@@` as "daemon-backed" — hidden-view
 * parking re-hydrates from the daemon buffer snapshot — must still tell them
 * apart.
 */
export const LOCAL_FALLBACK_SESSION_ID_MARKER = 'local-'

/**
 * Why the whole suffix is matched, not just the marker: the other two minting
 * sites emit an eight-character suffix (hex from `mintPtySessionId`, a
 * base64url digest slice from `ptySessionIdForAgentCreateOperation`, whose
 * alphabet does contain every character of `local-`). Requiring the marker plus
 * eight hex digits — fourteen characters — makes a collision impossible by
 * length rather than by luck, so no daemon-backed PTY can lose its parking.
 */
const LOCAL_FALLBACK_SESSION_ID_SUFFIX = new RegExp(
  `^${LOCAL_FALLBACK_SESSION_ID_MARKER}[0-9a-f]{8}$`
)

/** Whether this id names a degraded-fallback PTY owned by the local provider. */
export function isLocalFallbackPtySessionId(sessionId: string): boolean {
  const idx = sessionId.lastIndexOf(PTY_SESSION_ID_SEPARATOR)
  return (
    idx > 0 &&
    LOCAL_FALLBACK_SESSION_ID_SUFFIX.test(sessionId.slice(idx + PTY_SESSION_ID_SEPARATOR.length))
  )
}

/**
 * Recover the owning worktreeId from a minted session id.
 *
 * Why stricter than `lastIndexOf('@@')`: callers that drive memory
 * attribution must not synthesize a worktreeId for a sessionId that was
 * not minted by us — e.g. a bare UUID. Requiring both the `@@` separator
 * AND the `${repoId}::${path}` shape rejects those imposters cleanly.
 * Returns `{ worktreeId: null }` when the id does not match the minted
 * format.
 */
export function parsePtySessionId(sessionId: string): { worktreeId: string | null } {
  const idx = sessionId.lastIndexOf(PTY_SESSION_ID_SEPARATOR)
  if (idx <= 0) {
    return { worktreeId: null }
  }
  const candidate = sessionId.slice(0, idx)
  // Why: require non-empty halves on both sides of `::` so degenerate
  // ids like `::@@…`, `repo::@@…`, or `::path@@…` don't synthesize a
  // phantom worktreeId for memory attribution.
  const sepIdx = candidate.indexOf(WORKTREE_ID_SEPARATOR)
  if (sepIdx <= 0 || sepIdx + WORKTREE_ID_SEPARATOR.length >= candidate.length) {
    return { worktreeId: null }
  }
  return { worktreeId: candidate }
}
