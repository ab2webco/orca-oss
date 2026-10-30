import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_LAUNCH_HANDLERS } from './orchestrator-game-launch'
import { GAME_MCP_SERVERS_MISSING } from './orchestrator-game-launch-mcp'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

const TODO_ITEM = { id: 'CIN-12', title: 'Cartelera page', url: '', status: 'To Do' }

const stateWith = (lead: Record<string, unknown>) => ({
  config: { mode: 'on' },
  agents: [],
  worktree: { id: 'repo1::/repo', path: '/repo', branch: 'main', displayName: 'cineco' },
  project: { reviews: null, todo: { provider: 'jira', total: 1, url: null, items: [TODO_ITEM] } },
  lead: { autostart: false, cap: 2, agent: 'claude', ...lead }
})

const ACCOUNTS = {
  claude: { accounts: [{ id: 'acct_ana', email: 'ana@example.com' }], activeAccountId: null },
  codex: { accounts: [], activeAccountId: null },
  rateLimits: { claude: null, codex: null, inactiveClaudeAccounts: [], inactiveCodexAccounts: [] }
}

function fakeClient(state: unknown, mcp: unknown) {
  const calls: [string, unknown][] = []
  const results: Record<string, unknown> = {
    'game.state': state,
    'worktree.list': { worktrees: [] },
    'terminal.show': { terminal: { handle: 'h1' } },
    'status.get': { capabilities: [] },
    'orchestration.runCurrent': { run: { id: 'run_1' } },
    'accounts.snapshot': ACCOUNTS,
    'orchestration.taskCreate': { task: { id: 'task_1', status: 'ready' } },
    'orchestration.workerStart': {
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'dispatch_1',
      state: 'ready',
      effects: []
    }
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      if (method === 'game.memberMcpServers' && mcp instanceof Error) {
        throw mcp
      }
      return { ok: true, result: method === 'game.memberMcpServers' ? mcp : results[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const launch = (client: RuntimeClient, extra: [string, string | boolean][] = []) =>
  ORCHESTRATOR_GAME_LAUNCH_HANDLERS['game launch']({
    flags: new Map<string, string | boolean>([['ticket', 'cin-12'], ...extra]),
    client,
    cwd: '/repo',
    json: true
  })

const methodsOf = (calls: [string, unknown][]) => calls.map(([method]) => method)

describe('orca game launch: the MCP servers the project needs', () => {
  const saved = { ...process.env }
  let warnings: string[] = []

  beforeEach(() => {
    warnings = []
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      warnings.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'repo1::/repo'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('refuses by name, before any task exists, when the account lacks a listed server', async () => {
    const { client, calls } = fakeClient(stateWith({ mcpServers: ['tambora', 'Plane'] }), {
      checked: true,
      servers: ['plane'],
      connectors: ['claude.ai Gmail']
    })

    const refusal = await launch(client, [['account', 'ana@example.com']]).catch(
      (error: unknown) => error
    )

    expect(refusal).toBeInstanceOf(RuntimeClientError)
    expect((refusal as RuntimeClientError).code).toBe(GAME_MCP_SERVERS_MISSING)
    expect((refusal as Error).message).toBe(
      'CIN-12: this host · ana@example.com has no MCP server tambora, which is in orchestratorGame.orchestrator.mcpServers (it has plane, claude.ai Gmail). Add it there, launch on another --account or --on, or pass --skip-mcp-check.'
    )
    expect(methodsOf(calls)).not.toContain('orchestration.taskCreate')
    expect(calls.find(([method]) => method === 'game.memberMcpServers')?.[1]).toEqual({
      agent: 'claude',
      repo: 'id:repo1',
      claudeAccountId: 'acct_ana'
    })
  })

  it('asks the paired host, with the selector it resolves, for a member placed with --on', async () => {
    const { client, calls } = fakeClient(stateWith({ mcpServers: ['tambora'] }), {
      checked: true,
      servers: [],
      connectors: [],
      account: 'bo@m1.example'
    })

    const refusal = await launch(client, [
      ['on', 'm1'],
      ['repo', 'name:cineco'],
      ['account', 'auto']
    ]).catch((error: unknown) => error)

    expect(calls.find(([method]) => method === 'game.memberMcpServers')?.[1]).toEqual({
      agent: 'claude',
      repo: 'name:cineco',
      on: 'm1',
      account: 'auto'
    })
    expect((refusal as Error).message).toContain(
      'CIN-12: m1 · bo@m1.example has no MCP server tambora'
    )
    expect(methodsOf(calls)).not.toContain('orchestration.taskCreate')
  })

  it('launches when a claude.ai connector covers the name', async () => {
    const { client, calls } = fakeClient(stateWith({ mcpServers: ['Google Drive'] }), {
      checked: true,
      servers: [],
      connectors: ['claude.ai Google Drive']
    })

    await launch(client)

    expect(methodsOf(calls)).toContain('orchestration.workerStart')
    expect(warnings).toEqual([])
  })

  it('warns by name and launches when the host cannot tell', async () => {
    const { client, calls } = fakeClient(stateWith({ mcpServers: ['tambora'] }), {
      checked: false,
      reason: 'm1 runs an Orca that cannot list its MCP servers; update Orca there'
    })

    await launch(client)

    expect(warnings).toEqual([
      'Warning: CIN-12: could not check MCP servers tambora (m1 runs an Orca that cannot list its MCP servers; update Orca there); launching anyway.'
    ])
    expect(methodsOf(calls)).toContain('orchestration.workerStart')
  })

  it('warns and launches when this Orca has no such read', async () => {
    const { client, calls } = fakeClient(
      stateWith({ mcpServers: ['tambora'] }),
      new RuntimeClientError('method_not_found', 'Unknown method: game.memberMcpServers')
    )

    await launch(client)

    expect(warnings[0]).toContain('could not check MCP servers tambora (Unknown method')
    expect(methodsOf(calls)).toContain('orchestration.workerStart')
  })

  it('reads nothing when the project lists no servers, or with --skip-mcp-check', async () => {
    const none = fakeClient(stateWith({}), { checked: true, servers: [], connectors: [] })
    await launch(none.client)
    const skipped = fakeClient(stateWith({ mcpServers: ['tambora'] }), {
      checked: true,
      servers: [],
      connectors: []
    })
    await launch(skipped.client, [['skip-mcp-check', true]])

    for (const { calls } of [none, skipped]) {
      expect(methodsOf(calls)).not.toContain('game.memberMcpServers')
      expect(methodsOf(calls)).toContain('orchestration.workerStart')
    }
  })
})
