import { ORCHESTRATOR_GAME_FLEET_HANDLERS } from './orchestrator-game-fleet'
import type { RuntimeClient } from '../runtime-client'

/** Shared state, client and call filters for the `orca game fleet|wave|sweep|push|stop` handler tests. */
export const merged = {
  provider: 'github',
  number: 41,
  title: 'x',
  url: 'https://github.com/o/r/pull/41',
  state: 'merged',
  ci: 'success'
}

export const member = (overrides: Record<string, unknown>) => ({
  paneKey: 'p',
  displayName: 'CIN-1 Cartelera',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: 'term_1',
  ...overrides
})

export const LEAD = {
  paneKey: 'lead',
  displayName: 'Lead',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: true,
  terminalHandle: 'term_lead'
}

const todoItem = (id: string, group = 'todo') => ({
  id,
  title: `${id} title`,
  url: `https://jira/${id}`,
  status: 'To Do',
  group
})

export function stateWith(overrides: Record<string, unknown> = {}) {
  return {
    config: { mode: 'on' },
    agents: [LEAD],
    worktree: { id: 'wt1', path: '/repo', branch: 'main', displayName: 'cineco' },
    project: {
      reviews: null,
      todo: {
        provider: 'jira',
        total: 3,
        url: null,
        items: [todoItem('CIN-1'), todoItem('CIN-2'), todoItem('CIN-3')]
      }
    },
    lead: { autostart: false, cap: 2, agent: 'claude' },
    ...overrides
  }
}

const reading = (provider: string, accountId: string) => ({
  accountId,
  rateLimits: {
    provider,
    status: 'ok',
    session: { usedPercent: 10, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: 0,
    error: null
  },
  updatedAt: 0,
  isFetching: false
})

// Why one managed account per provider: a wave with no --account picks one (ORCA-809).
export const GAME_TEST_ACCOUNTS = {
  claude: { accounts: [{ id: 'acct_ana', email: 'ana@example.com' }], activeAccountId: null },
  codex: { accounts: [{ id: 'acct_bo', email: 'bo@example.com' }], activeAccountId: null },
  rateLimits: {
    claude: null,
    codex: null,
    inactiveClaudeAccounts: [reading('claude', 'acct_ana')],
    inactiveCodexAccounts: [reading('codex', 'acct_bo')]
  }
}

export function fakeClient(state: unknown, overrides: Record<string, unknown> = {}) {
  const calls: [string, unknown][] = []
  const results: Record<string, unknown> = {
    'game.state': state,
    'worktree.list': { worktrees: [] },
    'terminal.show': { terminal: { handle: 'term_lead' } },
    'orchestration.runCurrent': { run: { id: 'run_1' } },
    'orchestration.taskCreate': { task: { id: 'task_1' } },
    'game.stopSwitch': { stopped: null },
    'accounts.snapshot': GAME_TEST_ACCOUNTS,
    'orchestration.workerStart': {
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'd1',
      state: 'ready'
    },
    'orchestration.workerList': { workers: [], counts: {} },
    'orchestration.workerRelease': { dispatchId: 'd9', state: 'released', processAction: 'closed' },
    'terminal.close': { close: { handle: 'term_9', tabId: 't', ptyKilled: true } },
    'terminal.send': { send: { handle: 'term_1', accepted: true } },
    ...overrides
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { id: 'r', ok: true, result: results[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

export const run = (
  command: 'game fleet' | 'game wave' | 'game sweep' | 'game push' | 'game stop',
  client: RuntimeClient,
  flags: [string, string | boolean][] = []
) =>
  ORCHESTRATOR_GAME_FLEET_HANDLERS[command]({
    flags: new Map(flags),
    client,
    cwd: '/repo',
    json: true
  })

// Why: event posts and STOP reads are checked on their own (event-posts and hold tests).
const BOARD_CALLS = new Set(['game.eventPost', 'game.stopSwitch'])
export const methods = (calls: [string, unknown][]) =>
  calls.map(([method]) => method).filter((method) => !BOARD_CALLS.has(method))

// Why: freeing a member first records it; these reads and the write are checked on their own.
const HISTORY_CALLS = new Set([
  ...BOARD_CALLS,
  'game.historyRecord',
  'orchestration.inbox',
  'orchestration.workerShow'
])
export const freeing = (calls: [string, unknown][]) =>
  calls.filter(([method]) => !HISTORY_CALLS.has(method))
