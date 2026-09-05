import { useAppStore } from '../store'
import { readRuntimeWorktreeProgressFingerprint } from '../runtime/runtime-git-client'
import {
  resolveAgentStallTimerTarget,
  resolveWorktreeIdForPane,
  type AgentStallTimerTarget
} from './agent-stall-timer-target'
import { WORKTREE_REFRESH_CONCURRENCY } from '../store/slices/worktrees'
import type { AgentStallTimerIntervalMinutes } from '../../../shared/agent-stall-timer'
import type { WorktreeProgressProbeResult } from '../../../shared/worktree-progress-probe'

/** Ticks are due on a wall-clock deadline, so the poll only has to be finer than the shortest interval. */
export const AGENT_STALL_TIMER_POLL_MS = 30_000

const inFlightPaneKeys = new Set<string>()

async function readProgress(target: AgentStallTimerTarget): Promise<WorktreeProgressProbeResult> {
  try {
    const result = await readRuntimeWorktreeProgressFingerprint({
      settings: useAppStore.getState().settings,
      worktreeId: target.worktreeId,
      worktreePath: target.worktreePath
    })
    // A host too old to answer this can resolve with nothing at all; that is a reading we
    // did not get, never a stall.
    return result?.kind ? result : { kind: 'unreadable' }
  } catch {
    return { kind: 'unreadable' }
  }
}

/**
 * Arms or disarms one pane's stall timer, capturing the progress baseline immediately so the
 * first reading one interval later can already escalate.
 */
export function armAgentStallTimer(
  paneKey: string,
  intervalMinutes: AgentStallTimerIntervalMinutes | null
): void {
  const store = useAppStore.getState()
  store.setAgentStallTimer(paneKey, intervalMinutes)
  if (intervalMinutes === null) {
    return
  }
  const target = resolveAgentStallTimerTarget(store, paneKey)
  if (!target) {
    return
  }
  void readProgress(target).then((probe) => {
    useAppStore.getState().seedAgentStallTimerBaseline(paneKey, probe)
  })
}

export async function runDueAgentStallTicks(now = Date.now()): Promise<void> {
  const duePaneKeys = Object.entries(useAppStore.getState().agentStallTimerByPaneKey)
    .filter(([paneKey, entry]) => entry.nextTickAt <= now && !inFlightPaneKeys.has(paneKey))
    .map(([paneKey]) => paneKey)

  // Bounded like every other git fan-out here: one reading is up to five spawns, and panes
  // armed in a single sitting stay co-scheduled on the same poll for the whole session.
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(WORKTREE_REFRESH_CONCURRENCY, duePaneKeys.length) },
    async () => {
      while (cursor < duePaneKeys.length) {
        const paneKey = duePaneKeys[cursor]
        cursor += 1
        if (paneKey !== undefined) {
          await tickPane(paneKey)
        }
      }
    }
  )
  await Promise.all(workers)
}

async function tickPane(paneKey: string): Promise<void> {
  inFlightPaneKeys.add(paneKey)
  try {
    const target = resolveAgentStallTimerTarget(useAppStore.getState(), paneKey)
    const probe: WorktreeProgressProbeResult = target
      ? await readProgress(target)
      : { kind: 'unreadable' }
    const outcome = useAppStore.getState().applyAgentStallTick(paneKey, { probe, now: Date.now() })
    if (outcome === 'escalate') {
      escalateStalledPane(paneKey)
    }
  } finally {
    inFlightPaneKeys.delete(paneKey)
  }
}

/**
 * Escalation for the "check if it is stuck" preset: pull the user's eye to the workspace the
 * way a worker blocked on a human already does. Nothing is sent to the pane — a pane whose
 * process is dead accepts writes and consumes none, so a message would prove nothing.
 */
function escalateStalledPane(paneKey: string): void {
  const state = useAppStore.getState()
  const worktreeId = resolveWorktreeIdForPane(state, paneKey)
  if (!worktreeId) {
    return
  }
  state.markWorktreeUnread(worktreeId)
}

export function resetAgentStallTimerDriverForTest(): void {
  inFlightPaneKeys.clear()
}
