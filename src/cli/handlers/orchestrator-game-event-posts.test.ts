import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_LAUNCH_HANDLERS } from './orchestrator-game-launch'
import { ORCHESTRATOR_GAME_FLEET_HANDLERS } from './orchestrator-game-fleet'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

const LEAD = {
  paneKey: 'lead',
  displayName: 'Lead',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: true,
  terminalHandle: 'term_lead'
}

const MERGED_IN_QA = {
  paneKey: 'p1',
  displayName: 'CIN-1 Cartelera',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: 'term_1',
  review: {
    provider: 'github',
    number: 41,
    title: 'x',
    url: 'https://g/41',
    state: 'merged',
    ci: 'success'
  },
  workItem: {
    provider: 'jira',
    identifier: 'CIN-1',
    title: 'Cartelera',
    url: 'https://jira/CIN-1',
    status: 'QA',
    statusGroup: 'review'
  }
}

const state = (agents: unknown[]) => ({
  config: { mode: 'on' },
  agents,
  worktree: { id: 'wt1', path: '/repo', branch: 'main', displayName: 'cineco' },
  project: { reviews: null, todo: null },
  lead: { autostart: false, cap: 2, agent: 'claude' }
})

function fakeClient(gameState: unknown, boardFails = false) {
  const calls: [string, unknown][] = []
  const results: Record<string, unknown> = {
    'game.state': gameState,
    'worktree.list': { worktrees: [] },
    'terminal.show': { terminal: { handle: 'term_lead' } },
    'orchestration.runCurrent': { run: { id: 'run_1' } },
    'orchestration.taskCreate': { task: { id: 'task_1' } },
    'orchestration.workerStart': {
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'd1',
      state: 'ready'
    },
    'orchestration.workerList': { workers: [] },
    'orchestration.inbox': { messages: [] },
    'game.historyRecord': { recorded: true },
    'terminal.close': { close: {} },
    'game.eventPost': { posted: true }
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      if (boardFails && method === 'game.eventPost') {
        throw new RuntimeClientError('method_not_found', 'Unknown method: game.eventPost')
      }
      return { ok: true, result: results[method] }
    }
  } as unknown as RuntimeClient
  const posts = () =>
    calls.filter(([method]) => method === 'game.eventPost').map(([, params]) => params)
  return { client, posts }
}

const run = (
  handlers: typeof ORCHESTRATOR_GAME_FLEET_HANDLERS,
  command: string,
  client: RuntimeClient,
  flags: [string, string | boolean][] = []
) => handlers[command]({ flags: new Map(flags), client, cwd: '/repo', json: true })

describe('game commands post what they did and saw to the event record', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
    process.env.ORCA_PANE_KEY = 'tab:lead'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('launch posts claimed for the ticket once its member started', async () => {
    const { client, posts } = fakeClient(state([LEAD]))

    await run(ORCHESTRATOR_GAME_LAUNCH_HANDLERS, 'game launch', client, [['ticket', 'cin-7']])

    expect(posts()).toEqual([
      {
        worktreeId: 'wt1',
        terminalHandle: 'term_lead',
        kind: 'claimed',
        ticket: 'CIN-7',
        text: 'member d1 [ready] claude'
      }
    ])
  })

  it('launch still succeeds on an Orca without events', async () => {
    const { client } = fakeClient(state([LEAD]), true)

    await expect(
      run(ORCHESTRATOR_GAME_LAUNCH_HANDLERS, 'game launch', client, [['ticket', 'cin-7']])
    ).resolves.toBeUndefined()
    expect(process.exitCode).toBeUndefined()
  })

  it('fleet and sweep post a merged PR and a QA handoff, keyed so the board keeps them once', async () => {
    for (const command of ['game fleet', 'game sweep']) {
      const { client, posts } = fakeClient(state([LEAD, MERGED_IN_QA]))

      await run(ORCHESTRATOR_GAME_FLEET_HANDLERS, command, client)

      expect(posts()).toEqual([
        expect.objectContaining({ kind: 'merged', ticket: 'CIN-1', key: 'merged CIN-1 #41' }),
        expect.objectContaining({
          kind: 'qa_handoff',
          ticket: 'CIN-1',
          key: 'qa_handoff CIN-1 #41'
        })
      ])
    }
  })
})
