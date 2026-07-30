/**
 * Liveness for account-directed (`--codex-account`) Codex PTYs.
 *
 * Why Codex needed its own fact (ORCA-130): the Codex pane registry records the
 * account EVERY daemon-host spawn inherited from the current selection, so it
 * cannot say which panes were launched under an explicit account override, and
 * nothing about it proves a daemon still hosts the session. Reattach routing
 * needs both — the directedness, and the ownership proof that keeps a cold
 * restore from turning into a spawn failure.
 *
 * The binding is written to disk inside the same sync-flushed transaction as
 * the pane's PTY binding, seeded here at startup, then reconciled against every
 * daemon adapter before any pane restores: a binding that survives that pass is
 * hosted by some daemon.
 */

export type DirectedCodexPtyPersistence = {
  addCodexDirectedPtyAccountBinding(sessionId: string, accountId: string): void
  removeCodexDirectedPtyAccountBinding(sessionId: string): void
}

const liveDirectedCodexPtyAccounts = new Map<string, string>()
const seededUnconfirmedDirectedCodexPtyIds = new Set<string>()

let persistence: DirectedCodexPtyPersistence | null = null

export function attachDirectedCodexPtyPersistence(
  target: DirectedCodexPtyPersistence | null
): void {
  persistence = target
}

export function seedDirectedCodexPtyBindingsFromPersistence(
  bindings: readonly { sessionId: string; accountId: string }[]
): void {
  for (const { sessionId, accountId } of bindings) {
    liveDirectedCodexPtyAccounts.set(sessionId, accountId)
    seededUnconfirmedDirectedCodexPtyIds.add(sessionId)
  }
}

export function hasSeededUnconfirmedDirectedCodexPtys(): boolean {
  return seededUnconfirmedDirectedCodexPtyIds.size > 0
}

/**
 * Releases every seeded binding no daemon reported. Phantom bindings must go:
 * an asserted-but-dead session would force reattach on a cold restore, which
 * fails the spawn outright instead of opening the pane.
 */
export function confirmSeededDirectedCodexPtyBindings(
  aliveSessionIds: readonly string[]
): void {
  const alive = new Set(aliveSessionIds)
  for (const sessionId of seededUnconfirmedDirectedCodexPtyIds) {
    if (!alive.has(sessionId)) {
      liveDirectedCodexPtyAccounts.delete(sessionId)
      persistence?.removeCodexDirectedPtyAccountBinding(sessionId)
    }
  }
  seededUnconfirmedDirectedCodexPtyIds.clear()
}

/** Called once the directed spawn returned, so the id is live by construction. */
export function markDirectedCodexPtySpawned(ptyId: string, accountId: string): void {
  liveDirectedCodexPtyAccounts.set(ptyId, accountId)
  seededUnconfirmedDirectedCodexPtyIds.delete(ptyId)
}

/**
 * Drops the binding for a session that is gone. Retaining one would keep asking
 * every later restore to reattach to a process no daemon can produce.
 */
export function releaseDirectedCodexPtyBinding(ptyId: string): void {
  const hadBinding = liveDirectedCodexPtyAccounts.delete(ptyId)
  seededUnconfirmedDirectedCodexPtyIds.delete(ptyId)
  if (hadBinding) {
    persistence?.removeCodexDirectedPtyAccountBinding(ptyId)
  }
}

export function getDirectedCodexPtyAccountId(ptyId: string): string | null {
  return liveDirectedCodexPtyAccounts.get(ptyId) ?? null
}

export const _internals = {
  reset: (): void => {
    liveDirectedCodexPtyAccounts.clear()
    seededUnconfirmedDirectedCodexPtyIds.clear()
    persistence = null
  }
}
