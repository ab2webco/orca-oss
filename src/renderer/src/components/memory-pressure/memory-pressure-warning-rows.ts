import type { MemoryPressurePane } from '../../../../shared/memory-pressure-types'
import type { AgentStatusEntry, AgentType } from '../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'

export type MemoryPressureRowContext = {
  tabsByWorktree: Record<
    string,
    readonly Pick<TerminalTab, 'id' | 'title' | 'defaultTitle' | 'customTitle'>[]
  >
  ptyIdsByTabId: Record<string, readonly string[]>
  agentStatusByPaneKey: Record<string, Pick<AgentStatusEntry, 'paneKey' | 'agentType'>>
  repoConnectionIdById: ReadonlyMap<string, string | null>
}

export type MemoryPressureRow = {
  sessionId: string
  /** Null when no tab in this window owns the session; it can still be closed. */
  tabId: string | null
  paneKey: string | null
  title: string | null
  agentType: AgentType | null
  project: string
  memory: number
  /** Null when the PTY has not printed in this app session. */
  idleMs: number | null
}

function findTab(
  pane: MemoryPressurePane,
  ctx: MemoryPressureRowContext
): Pick<TerminalTab, 'id' | 'title' | 'defaultTitle' | 'customTitle'> | null {
  // Why both paths: warm-reattached daemon sessions are registered without a pane key.
  const tabId =
    (pane.paneKey ? parsePaneKey(pane.paneKey)?.tabId : undefined) ??
    Object.entries(ctx.ptyIdsByTabId).find(([, ptyIds]) => ptyIds.includes(pane.sessionId))?.[0]
  if (!tabId) {
    return null
  }
  for (const tabs of Object.values(ctx.tabsByWorktree)) {
    const tab = tabs.find((candidate) => candidate.id === tabId)
    if (tab) {
      return tab
    }
  }
  return null
}

function findAgentType(
  pane: MemoryPressurePane,
  tabId: string | null,
  ctx: MemoryPressureRowContext
): AgentType | null {
  const exact = pane.paneKey ? ctx.agentStatusByPaneKey[pane.paneKey] : undefined
  if (exact?.agentType) {
    return exact.agentType
  }
  if (!tabId) {
    return null
  }
  const prefix = `${tabId}:`
  const entry = Object.values(ctx.agentStatusByPaneKey).find((candidate) =>
    candidate.paneKey.startsWith(prefix)
  )
  return entry?.agentType ?? null
}

export function buildMemoryPressureRows(
  panes: readonly MemoryPressurePane[],
  ctx: MemoryPressureRowContext,
  now: number
): MemoryPressureRow[] {
  return panes.map((pane) => {
    const tab = findTab(pane, ctx)
    const tabId = tab?.id ?? null
    const title =
      tab?.customTitle?.trim() || tab?.title?.trim() || tab?.defaultTitle?.trim() || null
    return {
      sessionId: pane.sessionId,
      tabId,
      paneKey: pane.paneKey,
      title,
      agentType: findAgentType(pane, tabId, ctx),
      project:
        pane.worktreeName && pane.worktreeName !== pane.repoName
          ? `${pane.repoName} / ${pane.worktreeName}`
          : pane.repoName,
      memory: pane.memory,
      idleMs: pane.lastOutputAt === null ? null : Math.max(0, now - pane.lastOutputAt)
    }
  })
}

/** Live terminal tabs in SSH-backed repos: their processes are remote and never measured. */
export function countRemoteTerminals(ctx: MemoryPressureRowContext): number {
  let count = 0
  for (const [worktreeId, tabs] of Object.entries(ctx.tabsByWorktree)) {
    if (!ctx.repoConnectionIdById.get(getRepoIdFromWorktreeId(worktreeId))) {
      continue
    }
    count += tabs.filter((tab) => (ctx.ptyIdsByTabId[tab.id]?.length ?? 0) > 0).length
  }
  return count
}
