import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_FLEET_HANDLERS } from './orchestrator-game-fleet'
import { RuntimeClientError } from '../runtime-client'
import { formatStop } from './orchestrator-game-stop'
import { formatFleet } from './orchestrator-game-fleet-format'
import { gameFleetReportOf } from '../../shared/orchestrator-game-fleet-verbs'
import { DEFAULT_GAME_LEAD } from '../../shared/orchestrator-game-lead'
import { ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import {
  LEAD,
  fakeClient,
  freeing,
  member,
  merged,
  methods,
  run,
  stateWith
} from './orchestrator-game-fleet-test-fixtures'

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
    // Why: an Orca pane exports the host's ORCA_GAME_LOCALE; the names must not follow it.
    delete process.env.ORCA_GAME_LOCALE
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

  it('fleet text counts limited members and says how to move them', async () => {
    const { client } = fakeClient(
      stateWith({
        agents: [
          LEAD,
          member({
            state: 'idle',
            limit: { resetsAt: null },
            account: { provider: 'claude', id: 'acct_ana', email: 'ana@example.com' }
          })
        ]
      })
    )

    await ORCHESTRATOR_GAME_FLEET_HANDLERS['game fleet']({
      flags: new Map(),
      client,
      cwd: '/repo',
      json: false
    })

    const text = output.join('\n')
    expect(text).toContain('limited 1')
    expect(text).toMatch(/limited\s+CIN-1.*game move CIN-1, or wait for the reset/)
    expect(text).toMatch(/AGENT\s+ACCOUNT/)
    expect(text).toMatch(/claude\s+ana@example\.com/)
  })

  it('fleet text lists members paused by a restart and how to resume or discard them', async () => {
    const { client } = fakeClient(
      stateWith({
        agents: [LEAD],
        pausedMembers: [
          {
            ticket: 'CIN-7',
            name: 'Merlin · CIN-7 Cartelera',
            agent: 'claude',
            account: 'ana@example.com',
            branch: 'cin-7',
            lastState: 'working',
            resumable: true,
            runId: 'run_1',
            since: '2026-10-20T10:00:00.000Z'
          },
          {
            ticket: 'CIN-8',
            name: null,
            agent: 'codex',
            account: null,
            branch: null,
            lastState: 'launching',
            resumable: false,
            runId: 'run_1',
            since: '2026-10-20T10:00:00.000Z'
          }
        ]
      })
    )

    await ORCHESTRATOR_GAME_FLEET_HANDLERS['game fleet']({
      flags: new Map(),
      client,
      cwd: '/repo',
      json: false
    })

    const text = output.join('\n')
    expect(text).toContain('Paused since Orca or the machine restarted: 2')
    expect(text).toContain('game resume-members')
    expect(text).toMatch(/CIN-7\s+working\s+cin-7\s+claude\s+ana@example\.com\s+its conversation/)
    expect(text).toMatch(/CIN-8\s+launching\s+-\s+codex\s+-\s+a new launch in its worktree/)
  })

  it('fleet text says why paused members cannot be resumed', async () => {
    const { client } = fakeClient(
      stateWith({ agents: [LEAD], pausedMembersError: 'the saved members file is damaged' })
    )

    await ORCHESTRATOR_GAME_FLEET_HANDLERS['game fleet']({
      flags: new Map(),
      client,
      cwd: '/repo',
      json: false
    })

    expect(output.join('\n')).toContain(
      'Could not resume members: the saved members file is damaged'
    )
  })

  it('fleet text shows each host’s load, and wave stops at this Orca’s cap (ORCA-888)', async () => {
    const onImac = member({
      paneKey: 'i',
      displayName: 'CIN-9 on imac',
      remote: { host: 'imac', stateKnown: true }
    })
    const state = stateWith({
      agents: [LEAD, member({}), onImac],
      lead: { autostart: false, cap: 7, agent: 'claude' },
      hosts: [
        { host: 'local', cap: 1, status: 'ok' },
        { host: 'imac', id: 'env-imac', cap: 6, status: 'ok' }
      ]
    })
    const text = formatFleet(gameFleetReportOf(state as never))
    expect(text.split('\n')[1]).toBe('Hosts: local 1/1 · imac 1/6')

    const { client, calls } = fakeClient(state)
    await run('game wave', client, [['dry-run', true]])
    expect(methods(calls)).toEqual(['game.state'])
    expect(printed()).toEqual(
      expect.objectContaining({
        free: 0,
        launch: [],
        skipped: [
          { ticket: 'CIN-1', reason: 'already running' },
          { ticket: 'CIN-2', reason: 'cap' },
          { ticket: 'CIN-3', reason: 'cap' }
        ]
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

  it('wave counts a member queued behind a running setup as launched, not failed', async () => {
    const { client } = fakeClient(stateWith(), {
      'orchestration.workerStart': {
        runId: 'r1',
        taskId: 't1',
        state: 'queued',
        setupQueue: { position: 1, waitingOn: 'CIN-3' }
      }
    })

    await run('game wave', client, [['tickets', 'CIN-3,CIN-2']])

    expect(process.exitCode).toBeUndefined()
    expect(printed()).toEqual(
      expect.objectContaining({
        failed: [],
        launched: [
          expect.objectContaining({ ticket: 'CIN-3', state: 'queued' }),
          expect.objectContaining({ ticket: 'CIN-2', state: 'queued' })
        ]
      })
    )
  })

  it('fleet text lists the members queued behind a setup apart from the paused ones', () => {
    const fleet = gameFleetReportOf({
      lead: { ...DEFAULT_GAME_LEAD, cap: 3 },
      agents: [],
      queuedMembers: [{ ticket: 'CIN-4', name: null, position: 1, waitingOn: 'Arthur · CIN-3' }]
    })

    expect(formatFleet(fleet).split('\n').slice(1)).toEqual([
      'Queued behind a setup: 1 · each starts by itself',
      'CIN-4: queued #1, waiting on Arthur · CIN-3; it starts by itself'
    ])
  })

  it("fleet carries the host's GitHub budget", async () => {
    const githubBudget = {
      graphql: { limit: 5000, remaining: 400, resetAt: 1, orcaCalls: 12 },
      core: { limit: 5000, remaining: 4000, resetAt: 1, orcaCalls: 1 },
      top: [],
      low: true
    }
    const { client } = fakeClient(stateWith({ agents: [LEAD], githubBudget }))

    await run('game fleet', client)

    expect(printed().githubBudget).toEqual(githubBudget)
  })

  it("fleet text shows the GitHub budget and Orca's busiest calls under the head line", () => {
    const now = 1_800_000_000_000
    const bucket = { limit: 5000, remaining: 400, resetAt: now / 1000 + 600, orcaCalls: 12 }
    const fleet = {
      ...gameFleetReportOf({ lead: DEFAULT_GAME_LEAD, agents: [] }),
      githubBudget: {
        graphql: bucket,
        core: { ...bucket, remaining: 4000 },
        top: [{ shape: 'pr checks', bucket: 'graphql' as const, calls: 9 }],
        low: true
      }
    }

    expect(formatFleet(fleet, now).split('\n').slice(1)).toEqual([
      'GitHub API LOW, game reads slowed 5x: GraphQL 400/5000 left, Orca made 12 calls (resets in 10m) · REST 4000/5000 left, Orca made 12 calls (resets in 10m)',
      "Orca's busiest calls this hour: pr checks 9"
    ])
  })

  it("fleet text shows each member's last host-observed activity and an orphaned member's next step", () => {
    const now = Date.parse('2026-10-22T12:10:00.000Z')
    const fleet = gameFleetReportOf({
      lead: DEFAULT_GAME_LEAD,
      agents: [
        {
          ...member({ displayName: 'CIN-5 Pagos' }),
          state: 'working',
          orphaned: true,
          lastActivityAt: '2026-10-22T12:08:00.000Z'
        }
      ]
    })

    const [, header, row] = formatFleet(fleet, now).split('\n')

    expect(header).toMatch(/\bACTIVE\b/)
    expect(row).toContain('2m ago')
    expect(row).toContain('orphaned, still working: adopt its work or stop it')
  })

  it('wave names each member it launches after a different free character of the scene', async () => {
    const { client, calls } = fakeClient(
      stateWith({
        config: { mode: 'on', scene: 'quest' },
        agents: [LEAD, member({ displayName: 'Arthur · CIN-9 Older', isMember: true })],
        lead: { autostart: false, cap: 3, agent: 'claude' }
      })
    )

    await run('game wave', client, [['tickets', 'CIN-2,CIN-3']])

    const starts = calls.filter(([method]) => method === 'orchestration.workerStart')
    expect(starts.map(([, params]) => (params as { displayName: string }).displayName)).toEqual([
      'Merlin · CIN-2 CIN-2 title',
      'Lancelot · CIN-3 CIN-3 title'
    ])
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
      state: 'done',
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
      member({
        paneKey: 'f',
        displayName: 'CIN-9',
        state: 'done',
        review: merged,
        terminalHandle: 'term_9'
      }),
      member({
        paneKey: 'g',
        displayName: 'CIN-8',
        state: 'done',
        review: merged,
        terminalHandle: 'term_8'
      })
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

    expect(freeing(calls.slice(1))).toEqual([
      ['orchestration.workerList', {}],
      ['orchestration.workerRelease', { dispatch: 'd9' }],
      ['terminal.close', { terminal: 'term_8' }]
    ])
    expect(printed().finished.map((entry: { closed: unknown }) => entry.closed)).toEqual([
      { via: 'release', dispatchId: 'd9', state: 'released' },
      { via: 'close', terminal: 'term_8' }
    ])
  })

  it('sweep --close never frees a member game state reports working, even with its ticket done (ORCA-862)', async () => {
    const agents = [
      LEAD,
      member({
        paneKey: 'remote:ctx_8eba552ae8ed',
        displayName: 'CIN-1295',
        terminalHandle: 'term_91c7514f',
        remote: { host: 'imac', stateKnown: true, ticketDone: true }
      }),
      member({ paneKey: 'f', displayName: 'CIN-9', review: merged, terminalHandle: 'term_9' })
    ]
    const { client, calls } = fakeClient(stateWith({ agents }))

    await run('game sweep', client, [['close', true]])

    expect(methods(calls)).toEqual(['game.state'])
    expect(printed()).toEqual({ closed: true, finished: [] })
  })

  it('sweep --close leaves a release Orca could not prove as a failure, never a terminal close', async () => {
    const agents = [
      LEAD,
      member({
        paneKey: 'f',
        displayName: 'CIN-9',
        state: 'done',
        review: merged,
        terminalHandle: 'term_9'
      })
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

  it('sweep --close records each finished member in the history before freeing it', async () => {
    const agents = [
      LEAD,
      member({
        paneKey: 'f',
        displayName: 'Arthur · CIN-9 Seats',
        state: 'done',
        review: merged,
        terminalHandle: 'term_9',
        workItem: {
          provider: 'jira',
          identifier: 'CIN-9',
          title: 't',
          url: 'u',
          status: 'QA',
          statusGroup: 'review'
        },
        account: { provider: 'claude', id: 'acct_ana', email: 'ana@example.com' },
        worktree: { id: 'wt_9', branch: 'cin-9', displayName: 'cin-9' }
      })
    ]
    const { client, calls } = fakeClient(stateWith({ agents }), {
      'orchestration.workerList': {
        workers: [{ dispatchId: 'd9', agentTerminalHandle: 'term_9', terminalState: 'active' }],
        counts: {}
      },
      'orchestration.workerShow': { worker: { created_at: '2026-10-16 09:00:00' } },
      'orchestration.inbox': {
        messages: [
          {
            from_handle: 'term_9',
            to_handle: 'term_lead',
            type: 'worker_done',
            subject: 'done',
            body: 'CIN-9 merged, moved to QA',
            created_at: '2026-10-16 11:00:00'
          }
        ],
        count: 1
      },
      'game.historyRecord': { recorded: true, count: 1 }
    })

    await run('game sweep', client, [['close', true]])

    const order = methods(calls)
    expect(order.indexOf('game.historyRecord')).toBeLessThan(
      order.indexOf('orchestration.workerRelease')
    )
    expect(calls.find(([method]) => method === 'game.historyRecord')?.[1]).toEqual({
      worktreeId: 'wt1',
      terminalHandle: 'term_lead',
      memberWorktreeId: 'wt_9',
      character: 'Arthur',
      characterKey: 'arthur',
      record: expect.objectContaining({
        ticket: 'CIN-9',
        branch: 'cin-9',
        agent: 'claude',
        account: 'ana@example.com',
        launchedAt: '2026-10-16 09:00:00',
        outcome: 'qa',
        pr: '#41 merged',
        lastReport: 'CIN-9 merged, moved to QA'
      })
    })
  })

  it('still frees a member when its record cannot be written, and says so', async () => {
    const agents = [
      LEAD,
      member({
        paneKey: 'f',
        displayName: 'CIN-9',
        state: 'done',
        review: merged,
        terminalHandle: 'term_9'
      })
    ]
    const { client, calls } = fakeClient(stateWith({ agents }), {
      'orchestration.workerList': {
        workers: [{ dispatchId: 'd9', agentTerminalHandle: 'term_9', terminalState: 'active' }],
        counts: {}
      }
    })
    const call = client.call.bind(client)
    client.call = (async (method: string, params: unknown) => {
      if (method === 'game.historyRecord') {
        throw new Error('Unknown method: game.historyRecord')
      }
      return call(method, params)
    }) as typeof client.call

    await run('game sweep', client, [['close', true]])

    expect(methods(calls)).toContain('orchestration.workerRelease')
    expect(printed().finished[0]).toEqual(
      expect.objectContaining({ history: 'not recorded: Unknown method: game.historyRecord' })
    )
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

      expect(freeing(calls.slice(1))).toEqual([
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

      expect(freeing(calls.slice(1))).toEqual([
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

    it('reports a member whose tab is already closed as stopped, not failed', async () => {
      const agents = [
        LEAD,
        member({ paneKey: 'a', displayName: 'CIN-1', terminalHandle: 'term_1' })
      ]
      const { client } = fakeClient(stateWith({ agents }), {
        'orchestration.workerList': { workers: [], counts: {} }
      })
      const call = client.call.bind(client)
      client.call = (async (method: string, params: unknown) => {
        if (method === 'terminal.close') {
          throw new RuntimeClientError('runtime_error', 'tab_not_found')
        }
        return call(method, params)
      }) as typeof client.call

      await run('game stop', client, [['all', true]])

      expect(printed().members).toEqual([
        expect.objectContaining({
          ticket: 'CIN-1',
          outcome: 'stopped',
          alreadyClosedTerminal: 'term_1'
        })
      ])
      expect(printed().members[0]).not.toHaveProperty('reason')
      expect(process.exitCode).toBeUndefined()
      expect(formatStop(printed())).toBe('CIN-1 stopped (term_1 tab already closed)')
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

    it('records each member as stopped, limited or failed before stopping it', async () => {
      const agents = [
        LEAD,
        member({ paneKey: 'a', displayName: 'CIN-1', terminalHandle: 'term_1' }),
        member({
          paneKey: 'b',
          displayName: 'CIN-2',
          terminalHandle: 'term_2',
          limit: { resetsAt: null }
        }),
        member({ paneKey: 'c', displayName: 'CIN-3', terminalHandle: 'term_3' })
      ]
      const { client, calls } = fakeClient(stateWith({ agents }), {
        'orchestration.workerList': {
          workers: [
            worker('d1', 'term_1', 'ready', 'active'),
            worker('d2', 'term_2', 'ready', 'active'),
            worker('d3', 'term_3', 'start_unknown', 'active')
          ],
          counts: {}
        },
        'orchestration.workerStop': { dispatchId: 'd', state: 'stopped', processAction: 'none' },
        'game.historyRecord': { recorded: true, count: 1 }
      })

      await run('game stop', client, [['all', true]])

      const records = calls
        .filter(([method]) => method === 'game.historyRecord')
        .map(([, params]) => (params as { record: { ticket: string; outcome: string } }).record)
      expect(records.map((one) => [one.ticket, one.outcome])).toEqual([
        ['CIN-1', 'stopped'],
        ['CIN-2', 'limited'],
        ['CIN-3', 'stopped']
      ])
      const order = methods(calls)
      expect(order.indexOf('game.historyRecord')).toBeLessThan(
        order.indexOf('orchestration.workerStop')
      )
    })
  })
})
