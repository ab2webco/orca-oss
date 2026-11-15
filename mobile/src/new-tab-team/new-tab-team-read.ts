import { parsePaneKey } from '../../../src/shared/stable-pane-id'
import { hostLeadCallersOf } from '../hosts/host-team-line'
import type { TerminalOpenTarget } from '../session/host-terminal-open'
import { getRepoIdFromMobileWorktreeId } from '../session/mobile-session-route-helpers'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import type { OrchestratorGameState } from '../../../src/shared/orchestrator-game-state'
import { readLeadGameState } from '../team-drawer/team-drawer-rpc'
import { addMemberRosterOf, type AddMemberRoster } from './add-member-options'

/** The worktree project's lead as the + menu's Team group sees it (desktop: newTabTeamMenuStateOf). */
export type NewTabTeam =
  | { kind: 'unsupported' }
  | { kind: 'pending' }
  /** Both reads answered: nothing live or kept, so Start fresh lead is safe. */
  | { kind: 'none' }
  /** A lead read failed or the phone is offline: today's sheet, no team rows. */
  | { kind: 'unread' }
  | {
      kind: 'lead-live'
      lead: TerminalOpenTarget & { terminal: string }
      /** null when the lead's game.state could not be read, so Add member waits. */
      roster: AddMemberRoster | null
    }
  | { kind: 'lead-closed'; accountEmail: string | null }

type Rec = Record<string, unknown>

const recordOf = (value: unknown): Rec | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null

async function resultOf(request: Promise<RpcResponse>): Promise<unknown> {
  const response = await request.catch(() => null)
  return response?.ok ? response.result : undefined
}

async function accountEmailOf(client: RpcClient, accountId: string): Promise<string | null> {
  const claude = recordOf(recordOf(await resultOf(client.sendRequest('accounts.list')))?.claude)
  const accounts = Array.isArray(claude?.accounts) ? claude.accounts : []
  const email = accounts.map(recordOf).find((account) => account?.id === accountId)?.email
  return typeof email === 'string' ? email : null
}

function rosterOf(state: unknown): AddMemberRoster | null {
  try {
    return addMemberRosterOf(state as OrchestratorGameState)
  } catch {
    // Why: a host answering an unexpected shape holds Add member instead of losing Go to lead.
    return null
  }
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
  if (leads === undefined) {
    return { kind: 'unread' }
  }
  const lead = hostLeadCallersOf(leads).find(
    (caller) => getRepoIdFromMobileWorktreeId(caller.worktreeId) === repoId
  )
  const tabId = lead ? parsePaneKey(lead.paneKey)?.tabId : undefined
  if (lead && tabId) {
    const state = await readLeadGameState(client, lead).catch(() => null)
    return {
      kind: 'lead-live',
      lead: { worktreeId: lead.worktreeId, terminal: lead.terminalHandle, tabId },
      roster: state?.status === 'ok' ? rosterOf(state.state) : null
    }
  }
  // Why any restoring pane: a phone cannot map a pane to its project, and a second team is worse than a wait.
  const restoring = recordOf(leads)?.restoring
  if (Array.isArray(restoring) && restoring.length > 0) {
    return { kind: 'pending' }
  }
  const stored = recordOf(
    await resultOf(client.sendRequest('game.leadStored', { worktreeId: args.worktreeId }))
  )
  if (!stored) {
    return { kind: 'unread' }
  }
  const kept = recordOf(stored.stored)
  const accountId = kept?.accountId
  if (accountId === null) {
    return { kind: 'lead-closed', accountEmail: null }
  }
  if (typeof accountId === 'string') {
    return { kind: 'lead-closed', accountEmail: await accountEmailOf(client, accountId) }
  }
  return { kind: 'none' }
}
