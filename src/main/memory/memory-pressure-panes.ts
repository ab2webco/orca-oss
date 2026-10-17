import type { MemorySnapshot } from '../../shared/process-stats-types'
import type { MemoryPressurePane } from '../../shared/memory-pressure-types'
import { ORPHAN_WORKTREE_ID } from '../../shared/constants'

export const MEMORY_PRESSURE_PANE_LIMIT = 5

/** The heaviest local terminal subtrees, footprint first where the platform reports it. */
export function rankMemoryPressurePanes(
  snapshot: MemorySnapshot,
  lastOutputAtFor: (sessionId: string) => number | null,
  limit: number = MEMORY_PRESSURE_PANE_LIMIT
): MemoryPressurePane[] {
  const panes: MemoryPressurePane[] = []
  for (const worktree of snapshot.worktrees) {
    for (const session of worktree.sessions) {
      const hasFootprint = typeof session.footprint === 'number'
      const memory = hasFootprint ? (session.footprint ?? 0) : session.memory
      if (!(memory > 0)) {
        continue
      }
      panes.push({
        sessionId: session.sessionId,
        paneKey: session.paneKey,
        worktreeId: worktree.worktreeId === ORPHAN_WORKTREE_ID ? null : worktree.worktreeId,
        worktreeName: worktree.worktreeName,
        repoName: worktree.repoName,
        memory,
        metric: hasFootprint ? 'phys-footprint' : snapshot.processMemoryMetric,
        lastOutputAt: lastOutputAtFor(session.sessionId)
      })
    }
  }
  return panes.sort((a, b) => b.memory - a.memory).slice(0, limit)
}
