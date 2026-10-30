import type { CommandHandler } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import {
  gameMcpServersMissingText,
  missingGameMcpServersOf,
  type GameMemberMcpInventory
} from '../../shared/orchestrator-game-member-mcp'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import type { GameRemotePlacement } from './orchestrator-game-launch-options'

type Client = Parameters<CommandHandler>[0]['client']

export const GAME_MCP_SERVERS_MISSING = 'mcp_servers_missing'

// Why bounded: a paired host's status read and its account pick can stall behind a dead relay.
const MCP_CHECK_TIMEOUT_MS = 45_000

/**
 * Refuses, before any effect, a member whose host and account lack an MCP server the project lists
 * in `orchestrator.mcpServers`; warns and goes on when the host cannot tell.
 */
export async function checkGameMemberMcpServers(args: {
  client: Client
  state: OrchestratorGameState
  ticket: string
  agent: string
  required: readonly string[] | undefined
  skip: boolean
  repo: string | null
  remote: GameRemotePlacement | null
  /** The local managed account the member is pinned to; absent for Orca's own selection. */
  account?: { id: string; email: string } | null
  /** The selector a paired host resolves (`auto` or an email). */
  remoteAccount?: string | null
}): Promise<void> {
  const required = args.required ?? []
  if (args.skip || required.length === 0) {
    return
  }
  const lead = args.state.worktree?.id
  const repo =
    args.remote?.repo ?? args.repo ?? (lead ? `id:${getRepoIdFromWorktreeId(lead)}` : null)
  const params = {
    agent: args.agent,
    ...(repo ? { repo } : {}),
    ...(args.remote
      ? { on: args.remote.on, ...(args.remoteAccount ? { account: args.remoteAccount } : {}) }
      : args.account
        ? { claudeAccountId: args.account.id }
        : {})
  }
  const warn = (reason: string): void =>
    console.error(
      `Warning: ${args.ticket}: could not check MCP servers ${required.join(', ')} (${reason}); launching anyway.`
    )
  let inventory: GameMemberMcpInventory
  try {
    inventory = (
      await args.client.call<GameMemberMcpInventory>('game.memberMcpServers', params, {
        timeoutMs: MCP_CHECK_TIMEOUT_MS
      })
    ).result
  } catch (error) {
    // Why never blocking here: an older Orca has no such read, and the start reports its own errors.
    warn(error instanceof Error ? error.message : String(error))
    return
  }
  if (!inventory.checked) {
    warn(inventory.reason)
    return
  }
  const missing = missingGameMcpServersOf(required, inventory)
  if (missing.length === 0) {
    return
  }
  const account =
    inventory.account ?? args.account?.email ?? (args.remote ? args.remoteAccount : null)
  const where = `${args.remote ? args.remote.on : 'this host'} · ${account ?? 'its default Claude login'}`
  throw new RuntimeClientError(
    GAME_MCP_SERVERS_MISSING,
    gameMcpServersMissingText({ ticket: args.ticket, missing, where, inventory })
  )
}
