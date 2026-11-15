import { parsePaneKey } from '../../../src/shared/stable-pane-id'
import { hostLeadCallersOf } from '../hosts/host-team-line'
import type { TerminalOpenTarget } from '../session/host-terminal-open'
import { getRepoIdFromMobileWorktreeId } from '../session/mobile-session-route-helpers'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'

/** The worktree project's lead as the + menu's Team group sees it (desktop: newTabTeamMenuStateOf). */
export type NewTabTeam =
  | { kind: 'unsupported' }
  | { kind: 'pending' }
  | { kind: 'none' }
  | { kind: 'lead-live'; lead: TerminalOpenTarget & { terminal: string } }

type Rec = Record<string, unknown>

const recordOf = (value: unknown): Rec | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null

async function resultOf(request: Promise<RpcResponse>): Promise<unknown> {
  const response = await request.catch(() => null)
  return response?.ok ? response.result : undefined
}

/** Reads the host's leads once per sheet open; a failed read keeps today's entries only. */
export async function readNewTabTeam(
  client: RpcClient,
  args: { supported: boolean; worktreeId: string }
): Promise<NewTabTeam> {
  if (!args.supported) {
    return { kind: 'unsupported' }
  }
  const repoId = getRepoIdFromMobileWorktreeId(args.worktreeId)
  const leads = await resultOf(client.sendRequest('game.leads'))
  const lead = hostLeadCallersOf(leads).find(
    (caller) => getRepoIdFromMobileWorktreeId(caller.worktreeId) === repoId
  )
  const tabId = lead ? parsePaneKey(lead.paneKey)?.tabId : undefined
  if (lead && tabId) {
    return {
      kind: 'lead-live',
      lead: { worktreeId: lead.worktreeId, terminal: lead.terminalHandle, tabId }
    }
  }
  // Why any restoring pane: a phone cannot map a pane to its project, and a second team is worse than a wait.
  const restoring = recordOf(leads)?.restoring
  if (Array.isArray(restoring) && restoring.length > 0) {
    return { kind: 'pending' }
  }
  return { kind: 'none' }
}
