import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'

/** The lead's open PRs and cap, as its home sends them to a member's paired host (ORCA-1301). */
export type RemoteGamePrCap = { open: number; cap: number }

// Why 5 min: the lead's panel reads the team every 30 s, so an older count means it stopped reading.
export const REMOTE_PR_CAP_FRESH_MS = 5 * 60_000

/** What the home adds to `federationShow`: the lead's count, once its review list was read. */
export function remotePrCapOf(state: OrchestratorGameState): RemoteGamePrCap | undefined {
  const open = state.project?.reviews?.total
  const cap = state.lead?.cap
  return open !== undefined && cap ? { open, cap } : undefined
}

/** The member host's latest count per Dispatch; held in memory, since the lead resends it. */
export class RemoteGamePrCaps {
  private readonly byDispatch = new Map<string, RemoteGamePrCap & { at: number }>()

  note(dispatchId: string, count: RemoteGamePrCap, now = Date.now()): void {
    this.byDispatch.set(dispatchId, { ...count, at: now })
  }

  freshOf(dispatchId: string, now = Date.now()): RemoteGamePrCap | undefined {
    const kept = this.byDispatch.get(dispatchId)
    return kept && now - kept.at <= REMOTE_PR_CAP_FRESH_MS
      ? { open: kept.open, cap: kept.cap }
      : undefined
  }
}
