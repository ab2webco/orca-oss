import { gatedLiveClaudePtyIds } from './live-pty-account-ownership'
import { markClaudePtyExited } from './live-pty-gate'
import {
  getLiveClaudePtyOwnershipEpoch,
  peekNextLiveClaudePtyOwnershipEpoch
} from './live-pty-ownership-epoch'

/**
 * The authoritative live-session inventory. Null means "could not be
 * established" — NOT "empty". See reconcileLiveClaudePtyGate for why the
 * difference decides whether anything is released.
 */
export type LiveClaudePtyInventory = () => Promise<readonly string[] | null>

let attachedInventory: LiveClaudePtyInventory | null = null
let inFlight: Promise<readonly string[]> | null = null

export function attachLiveClaudePtyGateInventory(inventory: LiveClaudePtyInventory | null): void {
  attachedInventory = inventory
}

/**
 * Releases gate entries for Claude PTYs that no longer exist.
 *
 * Why this is needed at all: `confirmSeededClaudeLivePtys` reconciles once, at
 * daemon init, over startup seeds only, and clears its set afterwards. Anything
 * registered in-session that misses `markClaudePtyExited` — a daemon-side kill
 * the main process never observed — stays "live" for the life of the app. That
 * entry keeps deferring the account's token rotation, so an account whose token
 * expires meanwhile can never be refreshed: the deadlock in ORCA-224.
 *
 * Why this does NOT weaken ORCA-211: the protection exists to keep a *running*
 * CLI's single-use refresh chain intact, and the only authority on "running" is
 * the daemon hosting the session. So:
 *
 * - a null inventory releases nothing. One unreachable daemon generation means
 *   unknown, not empty. (Daemon init may fail open on the same signal because no
 *   PTY can exist before it; at runtime that reasoning does not hold.)
 * - entries registered while the probe was in flight are kept, since the
 *   inventory could not have seen them.
 * - launch reservations are never touched. They hold an account before any
 *   session id exists, so no inventory can vouch for them.
 */
export async function reconcileLiveClaudePtyGate(
  dependencies: { inventory?: LiveClaudePtyInventory } = {}
): Promise<readonly string[]> {
  if (inFlight) {
    return inFlight
  }
  const inventory = dependencies.inventory ?? attachedInventory
  if (!inventory || gatedLiveClaudePtyIds().length === 0) {
    return []
  }
  const pass = runReconciliationPass(inventory).finally(() => {
    inFlight = null
  })
  inFlight = pass
  return pass
}

async function runReconciliationPass(
  inventory: LiveClaudePtyInventory
): Promise<readonly string[]> {
  const epochCursor = peekNextLiveClaudePtyOwnershipEpoch()
  let aliveSessionIds: readonly string[] | null = null
  try {
    aliveSessionIds = await inventory()
  } catch (error) {
    // Why: gate bookkeeping must never surface as a usage-refresh failure.
    console.warn('[claude-live-pty] Failed to read the live session inventory:', error)
    return []
  }
  if (!aliveSessionIds) {
    return []
  }
  const alive = new Set(aliveSessionIds)
  const released: string[] = []
  for (const ptyId of gatedLiveClaudePtyIds()) {
    if (alive.has(ptyId)) {
      continue
    }
    const epoch = getLiveClaudePtyOwnershipEpoch(ptyId)
    if (epoch !== null && epoch >= epochCursor) {
      continue
    }
    // Why route through the normal exit path: it clears every gate map, the
    // refresh-chain claim, persistence and the seeded sets in one place, and
    // wakes the launches and refreshes waiting on the account.
    markClaudePtyExited(ptyId)
    released.push(ptyId)
  }
  if (released.length > 0) {
    console.warn(
      `[claude-live-pty] Released ${released.length} Claude live-PTY gate entr(ies) for sessions no daemon hosts: ${released.join(', ')}`
    )
  }
  return released
}
