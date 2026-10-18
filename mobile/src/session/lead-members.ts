import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { sendSingleFlightRequest } from '../transport/request-single-flight'
import type { RpcClient } from '../transport/rpc-client'
import { WORKTREE_PS_FULL_LIMIT } from '../worktree/worktree-catalog-snapshot-client'
import type { MobileSessionTab } from './mobile-session-route-types'

/** A session a lead launched with `orca orchestration`, reached in its own worktree (ORCA-611). */
export type LeadMember = {
  worktreeId: string
  tabId: string
  label: string
  state: RuntimeWorktreeAgentRow['state']
}

type CatalogWorktree = {
  worktreeId: string
  displayName: string
  agents?: readonly RuntimeWorktreeAgentRow[]
}

/** The desktop pane key (`tabId:leafId`) that member rows name as their parentPaneKey. */
export function leadPaneKeyOf(tab: MobileSessionTab | null): string | null {
  if (tab?.type !== 'terminal' || !tab.parentTabId || !tab.leafId) {
    return null
  }
  // Why: a runtime-owned `pty:` tab id holds a ':' and never forms a pane key.
  return tab.parentTabId.includes(':') ? null : `${tab.parentTabId}:${tab.leafId}`
}

export function leadMembersOf(
  worktrees: readonly CatalogWorktree[],
  leadWorktreeId: string,
  leadPaneKey: string | null
): LeadMember[] {
  if (!leadPaneKey) {
    return []
  }
  return worktrees.flatMap((worktree) =>
    // Why: members keep their own worktrees; a subagent inside the lead's is not one.
    worktree.worktreeId === leadWorktreeId
      ? []
      : (worktree.agents ?? []).flatMap((row) => {
          const tabId = row.parentPaneKey === leadPaneKey ? row.paneKey.split(':')[0] : ''
          return tabId
            ? [
                {
                  worktreeId: worktree.worktreeId,
                  tabId,
                  label: row.displayName || worktree.displayName,
                  state: row.state
                }
              ]
            : []
        })
  )
}

export function leadMemberRoute(
  hostId: string,
  member: LeadMember
): { pathname: '/h/[hostId]/session/[worktreeId]'; params: Record<string, string> } {
  return {
    pathname: '/h/[hostId]/session/[worktreeId]',
    params: { hostId, worktreeId: member.worktreeId, tab: member.tabId }
  }
}

/** The host screen beneath keeps this catalog fresh; ask the host only when its cache lapsed. */
export async function readLeadCatalog(
  client: RpcClient,
  hostId: string,
  readCached: (hostId: string) => unknown[] | null
): Promise<CatalogWorktree[] | null> {
  const cached = readCached(hostId)
  if (cached) {
    return cached as CatalogWorktree[]
  }
  try {
    const response = await sendSingleFlightRequest(client, hostId, 'worktree.ps', {
      limit: WORKTREE_PS_FULL_LIMIT
    })
    return response.ok
      ? ((response.result as { worktrees?: CatalogWorktree[] }).worktrees ?? [])
      : null
  } catch {
    return null
  }
}
