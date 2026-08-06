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
 * The binding rides the pane's own sync-flushed PTY-binding transaction when
 * there is one, and is written here otherwise — a CLI create against a running
 * app persists no host session binding. Either way it is seeded at startup and
 * reconciled against every daemon adapter before any pane restores, so a
 * binding that survives that pass is hosted by some daemon.
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

/**
 * Called once the directed spawn returned, so the id is live by construction.
 *
 * Why a failed write does not undo the fact or stop the terminal: unlike a
 * Claude account binding, this one guards nothing but the next restore. Losing
 * it only degrades that pane back to the pre-fix behavior on the NEXT launch,
 * while killing a freshly spawned agent over a disk hiccup loses real work.
 */
export function markDirectedCodexPtySpawned(
  ptyId: string,
  accountId: string,
  options?: { persistenceAlreadyRecorded?: boolean }
): void {
  liveDirectedCodexPtyAccounts.set(ptyId, accountId)
  seededUnconfirmedDirectedCodexPtyIds.delete(ptyId)
  if (options?.persistenceAlreadyRecorded) {
    return
  }
  try {
    persistence?.addCodexDirectedPtyAccountBinding(ptyId, accountId)
  } catch (error) {
    console.warn(
      '[codex-directed-pty] Failed to persist the directed account binding; this pane loses its reattach gate after a restart:',
      error
    )
  }
}

/**
 * Drops the binding for a session that is gone. Retaining one would keep asking
 * every later restore to reattach to a process no daemon can produce.
 */
export function releaseDirectedCodexPtyBinding(ptyId: string): void {
  liveDirectedCodexPtyAccounts.delete(ptyId)
  seededUnconfirmedDirectedCodexPtyIds.delete(ptyId)
  // Why unconditional: an in-memory release that already happened must not leave
  // a disk row behind for the next launch to re-seed.
  persistence?.removeCodexDirectedPtyAccountBinding(ptyId)
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
