import type { MemoryPressurePane } from '../../../../shared/memory-pressure-types'
import type { AgentStatusEntry, AgentType } from '../../../../shared/agent-status-types'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../../shared/terminal-tab-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'
import {
  buildResourceSessionBindingIndex,
  type ResourceSessionBindingIndex
} from '../status-bar/resource-session-bindings'

export type MemoryPressureRowContext = {
  tabsByWorktree: Record<string, TerminalTab[]>
  ptyIdsByTabId: Record<string, string[]>
  terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot>
  deferredSshSessionIdsByTabId: Record<string, string>
  agentStatusByPaneKey: Record<string, Pick<AgentStatusEntry, 'paneKey' | 'agentType'>>
  repoConnectionIdById: ReadonlyMap<string, string | null>
}

export type MemoryPressureRow = {
  /** Live PTY id: Close kills this. */
  ptyId: string
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

// Why the Resource Manager's index: restored background tabs are bound only by layout and
// deferred-reattach wake hints until their pane mounts.
function bindingIndex(ctx: MemoryPressureRowContext): ResourceSessionBindingIndex {
  return buildResourceSessionBindingIndex({ ...ctx, workspaceSessionReady: true })
}

function findTab(
  pane: MemoryPressurePane,
  ctx: MemoryPressureRowContext,
  index: ResourceSessionBindingIndex
): TerminalTab | null {
  const tabId =
    (pane.paneKey ? parsePaneKey(pane.paneKey)?.tabId : undefined) ??
    index.ptyIdToTabId.get(pane.ptyId)
  const worktreeId = tabId ? index.tabIdToWorktreeId.get(tabId) : undefined
  if (!tabId || !worktreeId) {
    return null
  }
  return ctx.tabsByWorktree[worktreeId]?.find((candidate) => candidate.id === tabId) ?? null
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
  const index = bindingIndex(ctx)
  return panes.map((pane) => {
    const tab = findTab(pane, ctx, index)
    const tabId = tab?.id ?? null
    const title =
      tab?.customTitle?.trim() || tab?.title?.trim() || tab?.defaultTitle?.trim() || null
    return {
      ptyId: pane.ptyId,
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

/** Bound terminal tabs in SSH-backed repos: their processes are remote and never measured. */
export function countRemoteTerminals(ctx: MemoryPressureRowContext): number {
  const index = bindingIndex(ctx)
  const boundTabIds = new Set(index.ptyIdToTabId.values())
  let count = 0
  for (const tabId of boundTabIds) {
    const worktreeId = index.tabIdToWorktreeId.get(tabId)
    if (worktreeId && ctx.repoConnectionIdById.get(getRepoIdFromWorktreeId(worktreeId))) {
      count += 1
    }
  }
  return count
}
