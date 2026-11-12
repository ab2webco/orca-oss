import type { GameLateReviewCheck } from '../../../../shared/orchestrator-game-late-merges'
import { memberRosterOf } from '../../../../shared/orchestrator-game-member-names'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { OrcaRuntimeService } from '../../orca-runtime'

type LeadCaller = { worktreeId?: string; terminalHandle?: string }

/** What a late look needs from the host: the open PRs, their state, and where to write. */
export type LateMergePort = {
  checks: () => Promise<GameLateReviewCheck[]>
  /** The PR's hosted state, `merged` or `closed` among them; null when it cannot be read. */
  reviewStateOf: (check: GameLateReviewCheck) => Promise<string | null>
  pay: (check: GameLateReviewCheck, at: string) => Promise<void>
  settleClosed: (check: GameLateReviewCheck) => Promise<void>
}

// Why throttled: each look reads up to 20 reviews, and a lead's state is read every few seconds.
export const LATE_MERGE_CHECK_INTERVAL_MS = 5 * 60_000

/** Whether `scope` is due a look, recording this one when it is. */
export function lateMergeCheckDue(last: Map<string, number>, scope: string, now: number): boolean {
  if (now - (last.get(scope) ?? -Infinity) < LATE_MERGE_CHECK_INTERVAL_MS) {
    return false
  }
  last.set(scope, now)
  return true
}

/** Pays each freed member's PR that merged since it left, and settles each that closed (ORCA-1170). */
export async function checkLateGameMerges(port: LateMergePort, at: string): Promise<void> {
  for (const check of await port.checks()) {
    // Why one by one: a failed read costs that PR this look, never the others.
    const state = await port.reviewStateOf(check).catch(() => null)
    if (state === 'merged') {
      await port.pay(check, at)
    } else if (state === 'closed') {
      await port.settleClosed(check)
    }
  }
}

const lastByRuntime = new WeakMap<OrcaRuntimeService, Map<string, number>>()

/** In the background, a lead's look at its freed members' open PRs, at most once per interval. */
export function recordLateGameMerges(
  runtime: OrcaRuntimeService,
  state: OrchestratorGameState,
  caller: LeadCaller
): void {
  if (state.role !== 'lead') {
    return
  }
  const last = lastByRuntime.get(runtime) ?? new Map<string, number>()
  lastByRuntime.set(runtime, last)
  const scope = `${caller.worktreeId ?? ''}\n${caller.terminalHandle ?? ''}`
  if (!lateMergeCheckDue(last, scope, Date.now())) {
    return
  }
  const port = runtime.gameLateMergePort(caller, memberRosterOf(state))
  void checkLateGameMerges(port, new Date().toISOString()).catch(() => undefined)
}
