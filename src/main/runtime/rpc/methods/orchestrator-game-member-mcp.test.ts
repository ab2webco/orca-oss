import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GAME_MEMBER_MCP_SERVERS_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATOR_GAME_MEMBER_MCP_METHODS } from './orchestrator-game-member-mcp'

type Calls = [string, string, unknown][]

function dispatcherWith(runtime: Record<string, unknown>) {
  const dispatcher = new RpcDispatcher({
    runtime: { getRuntimeId: () => 'runtime', ...runtime } as unknown as OrcaRuntimeService,
    methods: ORCHESTRATOR_GAME_MEMBER_MCP_METHODS
  })
  return async (params: unknown) =>
    await dispatcher.dispatch({
      id: 'm',
      authToken: 'test',
      method: 'game.memberMcpServers',
      params
    })
}

function pairedHost(capabilities: string[], answer: unknown = null) {
  const calls: Calls = []
  return {
    calls,
    runtime: {
      resolveOrchestrationWorkerServer: () => ({ environmentId: 'env_m1', name: 'm1' }),
      callOrchestrationWorkerServer: async (env: string, method: string, params: unknown) => {
        calls.push([env, method, params])
        return method === 'status.get' ? { capabilities } : answer
      }
    }
  }
}

describe('game.memberMcpServers', () => {
  let vault: string

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'orca-member-mcp-rpc-'))
  })

  afterEach(async () => {
    await rm(vault, { recursive: true, force: true })
  })

  it("reads a pinned account's own vault, not this host's global login", async () => {
    await mkdir(vault, { recursive: true })
    await writeFile(
      join(vault, '.claude.json'),
      JSON.stringify({ mcpServers: { tambora: { command: 'uvx' } } })
    )
    const send = dispatcherWith({
      getClaudeManagedAuthPath: (id: string) => (id === 'acct_ana' ? vault : null)
    })

    await expect(send({ agent: 'claude', claudeAccountId: 'acct_ana' })).resolves.toMatchObject({
      ok: true,
      result: { checked: true, servers: ['tambora'], connectors: [] }
    })
    await expect(send({ agent: 'claude', claudeAccountId: 'acct_wsl' })).resolves.toMatchObject({
      ok: true,
      result: { checked: false }
    })
  })

  it('does not claim to know a Codex member or an SSH repo', async () => {
    const send = dispatcherWith({
      showRepo: async () => ({ displayName: 'cineco', path: '/srv/cineco', connectionId: 'ssh1' })
    })

    await expect(send({ agent: 'codex' })).resolves.toMatchObject({
      result: { checked: false, reason: "Orca cannot read a codex member's MCP servers yet" }
    })
    await expect(send({ agent: 'claude', repo: 'name:cineco' })).resolves.toMatchObject({
      result: { checked: false, reason: 'cineco runs its agents over SSH' }
    })
  })

  it('forwards to a paired host that can read its own, without --on', async () => {
    const answer = { checked: true, servers: [], connectors: [], account: 'bo@m1.example' }
    const host = pairedHost([GAME_MEMBER_MCP_SERVERS_RUNTIME_CAPABILITY], answer)
    const send = dispatcherWith(host.runtime)

    await expect(
      send({ on: 'm1', agent: 'claude', account: 'auto', repo: 'name:cineco' })
    ).resolves.toMatchObject({ ok: true, result: answer })
    expect(host.calls).toEqual([
      ['env_m1', 'status.get', undefined],
      ['env_m1', 'game.memberMcpServers', { agent: 'claude', account: 'auto', repo: 'name:cineco' }]
    ])
  })

  it('names an older paired host instead of asking it', async () => {
    const host = pairedHost([])
    const send = dispatcherWith(host.runtime)

    await expect(send({ on: 'm1', agent: 'claude' })).resolves.toMatchObject({
      result: {
        checked: false,
        reason: 'm1 runs an Orca that cannot list its MCP servers; update Orca there'
      }
    })
    expect(host.calls.map(([, method]) => method)).toEqual(['status.get'])
  })
})
