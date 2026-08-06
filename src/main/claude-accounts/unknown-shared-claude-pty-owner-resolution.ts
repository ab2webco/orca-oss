import { recordResolvedSharedClaudePtyOwner } from './resolved-shared-claude-pty-owner'
import {
  hasUnknownOwnerLiveSharedClaudePtys,
  isUnknownOwnerLiveSharedClaudePty
} from './live-pty-account-ownership'
import {
  resolveSharedClaudePtyOwner,
  type SharedClaudePtyOwnerProbe
} from './shared-claude-pty-owner'

export type LiveSharedClaudePtySession = { sessionId: string; pid: number | null }
export type LiveSharedClaudePtySessionLister = () => Promise<
  readonly LiveSharedClaudePtySession[] | null
>

export type UnknownSharedClaudePtyResolutionResult = {
  resolved: { sessionId: string; accountId: string | null }[]
  unresolved: { sessionId: string; reason: string }[]
}

/**
 * Asks each unknown-owner shared PTY's own process who it belongs to and records
 * the answer. Sessions whose owner is already known are skipped, so this is safe
 * to run repeatedly.
 */
export async function resolveUnknownSharedClaudePtyOwnersFor(
  sessions: readonly LiveSharedClaudePtySession[],
  probe: SharedClaudePtyOwnerProbe,
  dependencies: {
    isUnknownOwner?: (ptyId: string) => boolean
    record?: (ptyId: string, accountId: string | null) => boolean
  } = {}
): Promise<UnknownSharedClaudePtyResolutionResult> {
  const isUnknownOwner = dependencies.isUnknownOwner ?? isUnknownOwnerLiveSharedClaudePty
  const record = dependencies.record ?? recordResolvedSharedClaudePtyOwner
  const result: UnknownSharedClaudePtyResolutionResult = { resolved: [], unresolved: [] }
  for (const session of sessions) {
    if (!isUnknownOwner(session.sessionId)) {
      continue
    }
    const owner = await resolveSharedClaudePtyOwner(session.pid, probe)
    if (owner.kind === 'unknown') {
      result.unresolved.push({ sessionId: session.sessionId, reason: owner.reason })
      continue
    }
    const accountId = owner.kind === 'managed' ? owner.accountId : null
    if (record(session.sessionId, accountId)) {
      result.resolved.push({ sessionId: session.sessionId, accountId })
    }
  }
  return result
}

// Why retries instead of one pass at daemon init: the daemon may not report a pid
// yet, and a single miss used to leave the wildcard asserted for the life of the
// process — the permanent lockout ORCA-190 reports.
const RESOLUTION_ATTEMPT_DELAYS_MS = [0, 2_000, 10_000] as const

let attachedProbe: SharedClaudePtyOwnerProbe | null = null
let attachedLister: LiveSharedClaudePtySessionLister | null = null
let inFlight: Promise<void> | null = null

/** Installs the account/credential view the resolver needs. Attaching also kicks a
 *  pass, so main-process startup order between this and the daemon cannot matter. */
export function attachSharedClaudePtyOwnerProbe(probe: SharedClaudePtyOwnerProbe | null): void {
  attachedProbe = probe
  void resolveUnknownSharedClaudePtyOwners()
}

export function attachLiveSharedClaudePtySessionLister(
  lister: LiveSharedClaudePtySessionLister | null
): void {
  attachedLister = lister
  void resolveUnknownSharedClaudePtyOwners()
}

export async function resolveUnknownSharedClaudePtyOwners(
  dependencies: { sleep?: (ms: number) => Promise<void> } = {}
): Promise<void> {
  if (inFlight) {
    return inFlight
  }
  const probe = attachedProbe
  const lister = attachedLister
  if (!probe || !lister || !hasUnknownOwnerLiveSharedClaudePtys()) {
    return
  }
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const pass = runResolutionAttempts(probe, lister, sleep).finally(() => {
    inFlight = null
  })
  inFlight = pass
  return pass
}

async function runResolutionAttempts(
  probe: SharedClaudePtyOwnerProbe,
  lister: LiveSharedClaudePtySessionLister,
  sleep: (ms: number) => Promise<void>
): Promise<void> {
  for (const delayMs of RESOLUTION_ATTEMPT_DELAYS_MS) {
    if (!hasUnknownOwnerLiveSharedClaudePtys()) {
      return
    }
    if (delayMs > 0) {
      await sleep(delayMs)
    }
    try {
      const sessions = await lister()
      if (!sessions) {
        continue
      }
      const { resolved, unresolved } = await resolveUnknownSharedClaudePtyOwnersFor(sessions, probe)
      if (resolved.length > 0) {
        console.log(
          `[claude-live-pty] Resolved ${resolved.length} shared Claude session owner(s) from their live processes`
        )
      }
      if (unresolved.length > 0 && delayMs === RESOLUTION_ATTEMPT_DELAYS_MS.at(-1)) {
        console.warn(
          `[claude-live-pty] ${unresolved.length} shared Claude session(s) keep unknown ownership and still block assigned-account launches: ${unresolved
            .map((entry) => `${entry.sessionId} (${entry.reason})`)
            .join(', ')}`
        )
      }
    } catch (error) {
      // Why: ownership bookkeeping must never fail startup.
      console.warn('[claude-live-pty] Failed to resolve shared Claude session ownership:', error)
    }
  }
}
