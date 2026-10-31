import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { repoIsRemote } from '../../../../shared/agent-launch-remote'
import type { GameMemberMcpInventory } from '../../../../shared/orchestrator-game-member-mcp'
import { accountProviderOfAgent } from '../../../../shared/orchestrator-game-member-agent'
import { GAME_MEMBER_MCP_SERVERS_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import { claudeConfigFilePathOf } from '../../../claude-accounts/claude-folder-trust'
import { readClaudeMemberMcpInventory } from '../../../claude-accounts/member-mcp-inventory'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalString } from '../schemas'
import { resolveHostMemberAccount } from './orchestration-federation-member-account'

const GameMemberMcpServersParams = z.object({
  on: OptionalString,
  agent: OptionalString,
  claudeAccountId: OptionalString,
  // Why a selector: with --on the host resolves `auto` or an email against its own roster.
  account: OptionalString,
  repo: OptionalString
})

type GameMemberMcpServersInput = z.infer<typeof GameMemberMcpServersParams>

const REMOTE_TIMEOUT_MS = 30_000

async function remoteInventory(
  runtime: OrcaRuntimeService,
  params: GameMemberMcpServersInput & { on: string }
): Promise<GameMemberMcpInventory> {
  const server = runtime.resolveOrchestrationWorkerServer(params.on)
  const status = (await runtime.callOrchestrationWorkerServer(
    server.environmentId,
    'status.get',
    undefined,
    REMOTE_TIMEOUT_MS
  )) as RuntimeStatus
  if (!status.capabilities?.includes(GAME_MEMBER_MCP_SERVERS_RUNTIME_CAPABILITY)) {
    return {
      checked: false,
      reason: `${server.name} runs an Orca that cannot list its MCP servers; update Orca there`
    }
  }
  const { on: _on, ...forwarded } = params
  return (await runtime.callOrchestrationWorkerServer(
    server.environmentId,
    'game.memberMcpServers',
    forwarded,
    REMOTE_TIMEOUT_MS
  )) as GameMemberMcpInventory
}

async function localInventory(
  runtime: OrcaRuntimeService,
  params: GameMemberMcpServersInput
): Promise<GameMemberMcpInventory> {
  if (accountProviderOfAgent(params.agent) !== 'claude') {
    return {
      checked: false,
      reason: `Orca cannot read a ${params.agent ?? 'non-Claude'} member's MCP servers yet`
    }
  }
  const repo = params.repo ? await runtime.showRepo(params.repo).catch(() => null) : null
  // Why: an SSH repo's agent runs on that machine and loads its config, which this host cannot read.
  if (repo && repoIsRemote(repo)) {
    return { checked: false, reason: `${repo.displayName} runs its agents over SSH` }
  }
  const picked = params.account
    ? await resolveHostMemberAccount({
        runtime,
        agent: params.agent,
        selector: params.account,
        reusesTerminal: false
      })
    : null
  const accountId = params.claudeAccountId ?? picked?.pin.claudeAccountId
  let configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
  let configFile = claudeConfigFilePathOf(process.env)
  if (accountId) {
    const vault = runtime.getClaudeManagedAuthPath(accountId)
    if (vault === null) {
      return {
        checked: false,
        reason: 'its account keeps its Claude config where Orca cannot read it'
      }
    }
    configDir = vault
    configFile = join(vault, '.claude.json')
  }
  const inventory = await readClaudeMemberMcpInventory({
    configFile,
    configDir,
    repoPath: repo?.path ?? null
  })
  return {
    checked: true,
    ...inventory,
    ...(picked?.account ? { account: picked.account.email } : {})
  }
}

/** What MCP servers a member would load, read where it would run: this host or a paired one. */
export const ORCHESTRATOR_GAME_MEMBER_MCP_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'game.memberMcpServers',
    params: GameMemberMcpServersParams,
    handler: async (params, { runtime }) =>
      params.on
        ? await remoteInventory(runtime, { ...params, on: params.on })
        : await localInventory(runtime, params)
  })
]
