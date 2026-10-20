import type { MemorySnapshot } from '../../shared/process-stats-types'
import type { MemoryPressurePane } from '../../shared/memory-pressure-types'
import { ORPHAN_WORKTREE_ID } from '../../shared/constants'

export const MEMORY_PRESSURE_PANE_LIMIT = 5

export type MemoryPressureSessionLookup = (sessionId: string) => {
  ptyId: string
  lastOutputAt: number | null
}

// Why not parsePaneKey: the renderer matches agent tabs by prefix, so legacy leaf ids must match here too.
function tabIdOf(paneKey: string): string | null {
  const colon = paneKey.indexOf(':')
  return colon > 0 ? paneKey.slice(0, colon) : null
}

/** Agent panes first, then the heaviest local terminal subtrees, footprint first where the platform reports it. */
export function rankMemoryPressurePanes(
  snapshot: MemorySnapshot,
  lookupSession: MemoryPressureSessionLookup,
  agentPaneKeys: ReadonlySet<string>,
  limit: number = MEMORY_PRESSURE_PANE_LIMIT
): MemoryPressurePane[] {
  // Why tabs too: the renderer attributes an agent to its whole tab when the leaf differs.
  const agentTabIds = new Set(
    [...agentPaneKeys].map(tabIdOf).filter((tabId): tabId is string => tabId !== null)
  )
  const isAgentPane = (paneKey: string | null): boolean => {
    if (!paneKey) {
      return false
    }
    const tabId = tabIdOf(paneKey)
    return agentPaneKeys.has(paneKey) || (tabId !== null && agentTabIds.has(tabId))
  }
  const panes: { pane: MemoryPressurePane; agent: boolean }[] = []
  for (const worktree of snapshot.worktrees) {
    for (const session of worktree.sessions) {
      const hasFootprint = typeof session.footprint === 'number'
      const memory = hasFootprint ? (session.footprint ?? 0) : session.memory
      if (!(memory > 0)) {
        continue
      }
      const { ptyId, lastOutputAt } = lookupSession(session.sessionId)
      panes.push({
        agent: isAgentPane(session.paneKey),
        pane: {
          sessionId: session.sessionId,
          ptyId,
          paneKey: session.paneKey,
          worktreeId: worktree.worktreeId === ORPHAN_WORKTREE_ID ? null : worktree.worktreeId,
          worktreeName: worktree.worktreeName,
          repoName: worktree.repoName,
          memory,
          metric: hasFootprint ? 'phys-footprint' : snapshot.processMemoryMetric,
          lastOutputAt
        }
      })
    }
  }
  return panes
    .sort((a, b) => Number(b.agent) - Number(a.agent) || b.pane.memory - a.pane.memory)
    .slice(0, limit)
    .map((entry) => entry.pane)
}
