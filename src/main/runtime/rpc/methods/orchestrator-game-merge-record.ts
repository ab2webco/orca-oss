import { memberRosterOf } from '../../../../shared/orchestrator-game-member-names'
import { observedMergesOf } from '../../../../shared/orchestrator-game-observed-events'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { OrcaRuntimeService } from '../../orca-runtime'

type LeadCaller = { worktreeId?: string; terminalHandle?: string }

// Why remembered: a merged member stays listed until it is freed, and each poll would reread the board.
const recordedByRuntime = new WeakMap<OrcaRuntimeService, Set<string>>()

/**
 * Records each member merge the lead's state shows, with its review, before auto-release drops the
 * member's row: the lead's rewards and arcade offer read it from the board (ORCA-887).
 */
export async function recordGameMerges(
  runtime: OrcaRuntimeService,
  state: OrchestratorGameState,
  caller: LeadCaller
): Promise<void> {
  if (state.role !== 'lead') {
    return
  }
  const recorded = recordedByRuntime.get(runtime) ?? new Set<string>()
  recordedByRuntime.set(runtime, recorded)
  for (const { character, ...one } of observedMergesOf(state.agents, memberRosterOf(state))) {
    const id = `${caller.worktreeId ?? ''}\n${caller.terminalHandle ?? ''}\n${one.key}`
    if (recorded.has(id)) {
      continue
    }
    // Why claim before the await: the panel and the mod poll at once, and both would post it.
    recorded.add(id)
    try {
      // Why here: auto-release frees the member next and leaves no record its character could earn from.
      const credit = character ? { credit: { character, number: one.merge.number } } : {}
      await runtime.getGameBoard().postEvent({ ...caller, ...one, ...credit })
    } catch {
      // Why: a board that cannot be written must cost the merge its rewards, never the lead its state.
      recorded.delete(id)
    }
  }
}
