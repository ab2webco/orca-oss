import { ORCHESTRATOR_GAME_LAUNCH_HANDLERS } from './orchestrator-game-launch'
import type { RuntimeClient } from '../runtime-client'
import {
  ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY,
  ORCHESTRATION_WORKER_SETUP_QUEUE_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'

/** Shared state, client and launch call for the `orca game launch` handler tests. */
export const TODO_ITEM = {
  id: 'CIN-12',
  title: 'Cartelera page',
  url: 'https://jira.example/browse/CIN-12',
  status: 'To Do'
}

export function stateWith(overrides: Record<string, unknown> = {}) {
  return {
    config: { mode: 'on' },
    agents: [],
    worktree: { id: 'wt1', path: '/repo', branch: 'main', displayName: 'cineco' },
    project: { reviews: null, todo: { provider: 'jira', total: 1, url: null, items: [TODO_ITEM] } },
    lead: { autostart: false, cap: 2, agent: 'claude', launchPrompt: 'Implement {id}: {title}' },
    ...overrides
  }
}

const ACCOUNTS = {
  claude: {
    accounts: [{ id: 'acct_ana', email: 'ana@example.com' }],
    activeAccountId: 'acct_ana'
  },
  codex: { accounts: [{ id: 'acct_bo', email: 'bo@example.com' }], activeAccountId: null },
  rateLimits: { claude: null, codex: null, inactiveClaudeAccounts: [], inactiveCodexAccounts: [] }
}

export function fakeClient(
  state: unknown,
  run: { id: string } | null = { id: 'run_1' },
  overrides: Record<string, unknown> = {}
) {
  const calls: [string, unknown][] = []
  const results: Record<string, unknown> = {
    'game.state': state,
    'worktree.list': { worktrees: [] },
    'terminal.show': { terminal: { handle: 'h1' } },
    'status.get': {
      capabilities: [
        ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY,
        ORCHESTRATION_WORKER_SETUP_QUEUE_RUNTIME_CAPABILITY
      ]
    },
    'orchestration.runCurrent': { run },
    'accounts.snapshot': ACCOUNTS,
    'orchestration.runCreate': { run: { id: 'run_new', objective: 'x' } },
    'orchestration.taskCreate': { task: { id: 'task_1', status: 'ready' } },
    'orchestration.workerStart': {
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'dispatch_1',
      state: 'ready',
      effects: [],
      residualResources: []
    },
    ...overrides
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { ok: true, result: results[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

export const launch = (client: RuntimeClient, ticket = 'cin-12', extra: [string, string][] = []) =>
  ORCHESTRATOR_GAME_LAUNCH_HANDLERS['game launch']({
    flags: new Map([['ticket', ticket], ...extra]),
    client,
    cwd: '/repo',
    json: true
  })
