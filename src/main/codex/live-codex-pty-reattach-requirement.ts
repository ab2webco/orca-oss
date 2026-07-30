import { getDirectedCodexPtyAccountId } from './directed-codex-pty-binding'

/**
 * Whether restoring a surviving Codex PTY must reattach to whichever daemon
 * still owns it, instead of minting a fresh session under the same id.
 *
 * Why account-directed sessions need it (ORCA-130): `--codex-account` spawns on
 * the background path, and its restore never asked for reattach. Without the
 * flag `DaemonPtyRouter.adapterFor()` falls back to `this.current`, so after an
 * update that crossed the daemon protocol an account-directed pane restored
 * against the NEW daemon and silently minted an empty session under the
 * surviving id, while the real CLI kept running, unreachable, in the legacy one
 * — the same blank-pane-plus-orphan ORCA-124 fixed for Claude.
 *
 * Why this cannot break cold restore: the binding is reconciled against every
 * adapter (legacy included) before any pane restores, so a binding still held
 * here already proves some daemon hosts the session.
 *
 * Why there is no shared lane: Codex has no equivalent of a shared live-PTY
 * gate — an inherited selection is not an ownership claim, and demanding
 * reattach for it would fail cold restores it never protected.
 */
export function requiresLiveCodexPtyReattach(sessionId: string | undefined): boolean {
  if (!sessionId) {
    return false
  }
  return getDirectedCodexPtyAccountId(sessionId) !== null
}
