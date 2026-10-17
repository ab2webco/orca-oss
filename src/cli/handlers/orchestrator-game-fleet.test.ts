import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_FLEET_HANDLERS } from './orchestrator-game-fleet'
import type { RuntimeClient } from '../runtime-client'
import { ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY } from '../../shared/protocol-version'

const merged = {
  provider: 'github',
  number: 41,
  title: 'x',
  url: 'https://github.com/o/r/pull/41',
  state: 'merged',
  ci: 'success'
}

const member = (overrides: Record<string, unknown>) => ({
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

const LEAD = {
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

function stateWith(overrides: Record<string, unknown> = {}) {
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

function fakeClient(state: unknown, overrides: Record<string, unknown> = {}) {
  const calls: [string, unknown][] = []
  const results: Record<string, unknown> = {
    'game.state': state,
    'terminal.show': { terminal: { handle: 'term_lead' } },
    'orchestration.runCurrent': { run: { id: 'run_1' } },
    'orchestration.taskCreate': { task: { id: 'task_1' } },
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

const run = (
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

const methods = (calls: [string, unknown][]) => calls.map(([method]) => method)

describe('orca game fleet verbs', () => {
  const saved = { ...process.env }
  let output: string[] = []
  const printed = () => JSON.parse(output.join('')).result

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
    process.env.ORCA_PANE_KEY = 'tab:lead'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('fleet reads the caller state once and prints the members with free slots', async () => {
    const { client, calls } = fakeClient(stateWith({ agents: [LEAD, member({})] }))

    await run('game fleet', client)

    expect(calls).toEqual([
      ['game.state', { worktreeId: 'wt1', terminalHandle: 'term_lead', paneKey: 'tab:lead' }]
    ])
    expect(printed()).toEqual(
      expect.objectContaining({
        cap: 2,
        running: 1,
        free: 1,
        rows: [expect.objectContaining({ ticket: 'CIN-1', phase: 'working' })]
      })
    )
  })

  it('wave --dry-run plans from the To Do without launching anything', async () => {
    const { client, calls } = fakeClient(stateWith({ agents: [LEAD, member({})] }))

    await run('game wave', client, [['dry-run', true]])

    expect(methods(calls)).toEqual(['game.state'])
    expect(printed()).toEqual(
      expect.objectContaining({
        dryRun: true,
        launch: ['CIN-2'],
        skipped: [
          { ticket: 'CIN-1', reason: 'already running' },
          { ticket: 'CIN-3', reason: 'cap' }
        ],
        launched: []
      })
    )
  })

  it('wave launches the named tickets through the game launch path, never past the cap', async () => {
    const { client, calls } = fakeClient(stateWith())

    await run('game wave', client, [
      ['tickets', 'cin-3, CIN-2,CIN-1'],
      ['repo', 'name:cineco-frontend']
    ])

    const starts = calls.filter(([method]) => method === 'orchestration.workerStart')
    expect(starts.map(([, params]) => params)).toEqual([
      expect.objectContaining({
        name: 'cin-3',
        worktree: 'new-top-level',
        repo: 'name:cineco-frontend'
      }),
      expect.objectContaining({
        name: 'cin-2',
        worktree: 'new-top-level',
        repo: 'name:cineco-frontend'
      })
    ])
    expect(printed()).toEqual(
      expect.objectContaining({
        dryRun: false,
        skipped: [{ ticket: 'CIN-1', reason: 'cap' }],
        launched: [
          expect.objectContaining({ ticket: 'CIN-3', dispatchId: 'd1', state: 'ready' }),
          expect.objectContaining({ ticket: 'CIN-2', dispatchId: 'd1', state: 'ready' })
        ]
      })
    )
  })

  it('wave gives every member it launches the same agent, model and effort overrides', async () => {
    const { client, calls } = fakeClient(stateWith(), {
      'status.get': { capabilities: [ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY] }
    })

    await run('game wave', client, [
      ['tickets', 'CIN-1,CIN-2'],
      ['agent', 'codex'],
      ['model', 'gpt-5.5'],
      ['effort', 'high']
    ])

    const starts = calls.filter(([method]) => method === 'orchestration.workerStart')
    expect(starts.map(([, params]) => params)).toEqual([
      expect.objectContaining({ name: 'cin-1', agent: 'codex', model: 'gpt-5.5', effort: 'high' }),
      expect.objectContaining({ name: 'cin-2', agent: 'codex', model: 'gpt-5.5', effort: 'high' })
    ])
  })

  it('wave refuses a bad override before launching anything', async () => {
    const { client, calls } = fakeClient(stateWith())

    await expect(run('game wave', client, [['agent', 'cobol']])).rejects.toThrow(/Unknown agent/)
    expect(calls).toEqual([])
  })

  it('sweep without --close only lists finished members and touches nothing', async () => {
    const finished = member({
      paneKey: 'f',
      displayName: 'CIN-9',
      review: merged,
      terminalHandle: 'term_9'
    })
    const { client, calls } = fakeClient(
      stateWith({ agents: [LEAD, finished, member({ state: 'waiting' })] })
    )

    await run('game sweep', client)

    expect(methods(calls)).toEqual(['game.state'])
    expect(printed()).toEqual({
      closed: false,
      finished: [
        expect.objectContaining({
          row: expect.objectContaining({ ticket: 'CIN-9' }),
          pending: ['no linked ticket to confirm']
        })
      ]
    })
  })

  it('sweep --close releases a finished member through its dispatch, or closes its terminal without one', async () => {
    const agents = [
      LEAD,
      member({ state: 'waiting', terminalHandle: 'term_busy' }),
      member({ paneKey: 'f', displayName: 'CIN-9', review: merged, terminalHandle: 'term_9' }),
      member({ paneKey: 'g', displayName: 'CIN-8', review: merged, terminalHandle: 'term_8' })
    ]
    const { client, calls } = fakeClient(stateWith({ agents }), {
      'orchestration.workerList': {
        workers: [
          { dispatchId: 'd_old', agentTerminalHandle: 'term_9', terminalState: 'released' },
          { dispatchId: 'd9', agentTerminalHandle: 'term_9', terminalState: 'active' },
          { dispatchId: 'd_busy', agentTerminalHandle: 'term_busy', terminalState: 'active' }
        ],
        counts: {}
      }
    })

    await run('game sweep', client, [['close', true]])

    expect(calls.slice(1)).toEqual([
      ['orchestration.workerList', {}],
      ['orchestration.workerRelease', { dispatch: 'd9' }],
      ['terminal.close', { terminal: 'term_8' }]
    ])
    expect(printed().finished.map((entry: { closed: unknown }) => entry.closed)).toEqual([
      { via: 'release', dispatchId: 'd9', state: 'released' },
      { via: 'close', terminal: 'term_8' }
    ])
  })

  it('sweep --close leaves a release Orca could not prove as a failure, never a terminal close', async () => {
    const agents = [
      LEAD,
      member({ paneKey: 'f', displayName: 'CIN-9', review: merged, terminalHandle: 'term_9' })
    ]
    const { client, calls } = fakeClient(stateWith({ agents }), {
      'orchestration.workerList': {
        workers: [{ dispatchId: 'd9', agentTerminalHandle: 'term_9', terminalState: 'active' }],
        counts: {}
      },
      'orchestration.workerRelease': {
        dispatchId: 'd9',
        state: 'release_unknown',
        processAction: 'none'
      }
    })

    await run('game sweep', client, [['close', true]])

    expect(methods(calls)).not.toContain('terminal.close')
    expect(process.exitCode).toBe(1)
  })

  it('push sends the continue prompt only to idle members', async () => {
    const agents = [
      LEAD,
      member({ paneKey: 'w', displayName: 'CIN-2', terminalHandle: 'term_2' }),
      member({ paneKey: 'q', displayName: 'CIN-3', state: 'waiting', terminalHandle: 'term_3' }),
      member({ paneKey: 'i', displayName: 'CIN-1', state: 'done', terminalHandle: 'term_1' })
    ]
    const { client, calls } = fakeClient(
      stateWith({
        agents,
        lead: { autostart: false, cap: 2, agent: 'claude', pushPrompt: 'Go on {id}' }
      })
    )

    await run('game push', client)

    expect(calls.slice(1)).toEqual([
      [
        'terminal.send',
        {
          terminal: 'term_1',
          text: 'Go on CIN-1',
          enter: true,
          agentPrompt: true,
          client: { id: 'orca-cli', type: 'desktop' }
        }
      ]
    ])
    expect(
      printed().members.map((entry: { action: string; sent?: boolean }) => [
        entry.action,
        entry.sent
      ])
    ).toEqual([
      ['needs-you', false],
      ['leave', false],
      ['push', true]
    ])
  })

  it('push --dry-run sends nothing', async () => {
    const agents = [LEAD, member({ state: 'done' })]
    const { client, calls } = fakeClient(stateWith({ agents }))

    await run('game push', client, [['dry-run', true]])

    expect(methods(calls)).toEqual(['game.state'])
    expect(printed().members[0]).toEqual(expect.objectContaining({ action: 'push', sent: false }))
  })

  describe('stop', () => {
    const worker = (
      dispatchId: string,
      agentTerminalHandle: string | null,
      workerState: string,
      terminalState: string,
      worktreeId: string | null = null
    ) => ({
      dispatchId,
      agentTerminalHandle,
      workerState,
      terminalState,
      resource: worktreeId ? { worktreeId } : null
    })

    it('refuses without tickets or --all before reading anything', async () => {
      const { client, calls } = fakeClient(stateWith())

      await expect(run('game stop', client)).rejects.toThrow(/--all/)
      expect(calls).toEqual([])
    })

    it('--all stops each live dispatch and closes the terminal the stop left running, never the lead', async () => {
      const agents = [
        LEAD,
        member({ paneKey: 'a', displayName: 'CIN-1', terminalHandle: 'term_1' }),
        member({ paneKey: 'b', displayName: 'CIN-2', terminalHandle: 'term_2' }),
        member({ paneKey: 'c', displayName: 'CIN-3', terminalHandle: 'term_3' })
      ]
      const stops: Record<string, unknown> = {
        d1: { dispatchId: 'd1', state: 'stopped', processAction: 'closed_agent_terminal' },
        d2: { dispatchId: 'd2', state: 'stop_unknown', processAction: 'none', lastError: 'x' }
      }
      const { client, calls } = fakeClient(stateWith({ agents }), {
        'orchestration.workerList': {
          workers: [
            worker('d1', 'term_1', 'ready', 'active'),
            worker('d2', 'term_2', 'ready', 'active'),
            // Why: today's bug: the dispatch was stopped but its terminal stayed retained.
            worker('d3', 'term_3', 'stopped', 'retained'),
            worker('d_lead', 'term_lead', 'ready', 'active')
          ],
          counts: {}
        }
      })
      const call = client.call.bind(client)
      client.call = (async (method: string, params: { dispatch?: string }) =>
        method === 'orchestration.workerStop'
          ? (calls.push([method, params]), { ok: true, result: stops[params.dispatch ?? ''] })
          : call(method, params)) as typeof client.call

      await run('game stop', client, [['all', true]])

      expect(calls.slice(1)).toEqual([
        ['orchestration.workerList', {}],
        ['orchestration.workerStop', { dispatch: 'd1' }],
        ['orchestration.workerStop', { dispatch: 'd2' }],
        ['terminal.close', { terminal: 'term_2' }],
        ['terminal.close', { terminal: 'term_3' }]
      ])
      expect(printed().members).toEqual([
        expect.objectContaining({
          ticket: 'CIN-1',
          outcome: 'stopped',
          dispatchId: 'd1',
          dispatchState: 'stopped'
        }),
        expect.objectContaining({
          ticket: 'CIN-2',
          outcome: 'stopped',
          dispatchState: 'stop_unknown',
          closedTerminal: 'term_2'
        }),
        expect.objectContaining({ ticket: 'CIN-3', outcome: 'stopped', closedTerminal: 'term_3' })
      ])
      expect(process.exitCode).toBeUndefined()
    })

    it('stops only the named members, finds a dispatch by worktree and reports unknown tickets', async () => {
      const agents = [
        LEAD,
        member({
          paneKey: 'a',
          displayName: 'CIN-1',
          terminalHandle: 'term_new',
          worktree: { id: 'wt_1', branch: 'cin-1', displayName: 'cin-1' }
        }),
        member({ paneKey: 'b', displayName: 'CIN-2', terminalHandle: 'term_2' })
      ]
      const { client, calls } = fakeClient(stateWith({ agents }), {
        'orchestration.workerList': {
          workers: [worker('d1', 'term_old', 'ready', 'active', 'wt_1')],
          counts: {}
        },
        'orchestration.workerStop': {
          dispatchId: 'd1',
          state: 'stopped',
          processAction: 'closed_agent_terminal'
        }
      })

      await run('game stop', client, [['tickets', 'cin-1,CIN-9']])

      expect(calls.slice(1)).toEqual([
        ['orchestration.workerList', {}],
        ['orchestration.workerStop', { dispatch: 'd1' }],
        ['terminal.close', { terminal: 'term_new' }]
      ])
      expect(printed().members).toEqual([
        expect.objectContaining({ ticket: 'CIN-1', outcome: 'stopped', dispatchId: 'd1' }),
        expect.objectContaining({
          ticket: 'CIN-9',
          outcome: 'failed',
          reason: 'no member holds CIN-9'
        })
      ])
      expect(process.exitCode).toBe(1)
    })

    it('reports a member with nothing left as already stopped and a failed close as failed', async () => {
      const agents = [
        LEAD,
        member({ paneKey: 'a', displayName: 'CIN-1', terminalHandle: undefined }),
        member({ paneKey: 'b', displayName: 'CIN-2', terminalHandle: 'term_2' })
      ]
      const { client } = fakeClient(stateWith({ agents }), {
        'orchestration.workerList': { workers: [], counts: {} }
      })
      const call = client.call.bind(client)
      client.call = (async (method: string, params: unknown) => {
        if (method === 'terminal.close') {
          throw new Error('terminal busy')
        }
        return call(method, params)
      }) as typeof client.call

      await run('game stop', client, [['all', true]])

      expect(printed().members).toEqual([
        expect.objectContaining({ ticket: 'CIN-1', outcome: 'already stopped' }),
        expect.objectContaining({
          ticket: 'CIN-2',
          outcome: 'failed',
          reason: 'closing term_2 failed: terminal busy'
        })
      ])
      expect(process.exitCode).toBe(1)
    })

    it('still closes the terminal when the dispatch stop fails', async () => {
      const agents = [
        LEAD,
        member({ paneKey: 'a', displayName: 'CIN-1', terminalHandle: 'term_1' })
      ]
      const { client, calls } = fakeClient(stateWith({ agents }), {
        'orchestration.workerList': {
          workers: [worker('d1', 'term_1', 'ready', 'active')],
          counts: {}
        }
      })
      const call = client.call.bind(client)
      client.call = (async (method: string, params: unknown) => {
        if (method === 'orchestration.workerStop') {
          calls.push([method, params])
          throw new Error('runtime gone')
        }
        return call(method, params)
      }) as typeof client.call

      await run('game stop', client, [['all', true]])

      expect(methods(calls).slice(-1)).toEqual(['terminal.close'])
      expect(printed().members).toEqual([
        expect.objectContaining({
          outcome: 'stopped',
          closedTerminal: 'term_1',
          reason: 'dispatch stop failed: runtime gone'
        })
      ])
    })
  })
})
