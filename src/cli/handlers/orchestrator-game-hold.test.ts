import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GAME_TEST_ACCOUNTS } from './orchestrator-game-fleet-test-fixtures'
import { ORCHESTRATOR_GAME_HOLD_HANDLERS } from './orchestrator-game-hold'
import { ORCHESTRATOR_GAME_FLEET_HANDLERS } from './orchestrator-game-fleet'
import { ORCHESTRATOR_GAME_LAUNCH_HANDLERS } from './orchestrator-game-launch'
import { ORCHESTRATOR_GAME_MOVE_HANDLERS } from './orchestrator-game-move'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'
import type { CommandHandler } from '../dispatch'

const STOP = { since: '2026-10-16T10:00:00.000Z', by: 'lead' }

const LEAD = {
  paneKey: 'lead',
  displayName: 'Lead',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: true,
  terminalHandle: 'term_lead'
}

const member = (ticket: string, handle: string) => ({
  paneKey: `p-${ticket}`,
  displayName: `${ticket} work`,
  agentType: 'codex',
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: handle
})

const state = (stopped: unknown, agents: unknown[] = [LEAD]) => ({
  config: { mode: 'on' },
  agents,
  worktree: { id: 'wt1', path: '/repo', branch: 'main', displayName: 'cineco' },
  project: {
    reviews: null,
    todo: {
      provider: 'jira',
      total: 2,
      url: null,
      items: [
        { id: 'CIN-1', title: 'a', url: 'https://j/1', status: 'To Do', group: 'todo' },
        { id: 'CIN-2', title: 'b', url: 'https://j/2', status: 'To Do', group: 'todo' }
      ]
    }
  },
  lead: { autostart: false, cap: 4, agent: 'claude' },
  stopped
})

type Answer = object | ((params: Record<string, unknown>) => unknown)

function fakeClient(answers: Record<string, Answer>) {
  const calls: [string, Record<string, unknown>][] = []
  const client = {
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push([method, params])
      const answer = answers[method]
      const result = typeof answer === 'function' ? answer(params) : answer
      if (result instanceof Error) {
        throw result
      }
      return { ok: true, result }
    }
  } as unknown as RuntimeClient
  return { client, calls, methods: () => calls.map(([method]) => method) }
}

const run = (
  handlers: Record<string, CommandHandler>,
  command: string,
  client: RuntimeClient,
  flags: [string, string | boolean][] = []
) => handlers[command]({ flags: new Map(flags), client, cwd: '/repo', json: true })

describe('the persistent STOP', () => {
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

  it('stop --all --hold sets STOP before stopping anyone, then tells a member it could not stop', async () => {
    const { client, calls, methods } = fakeClient({
      'game.state': state(null, [LEAD, member('CIN-1', 'term_1'), member('CIN-2', 'term_2')]),
      'game.stopSwitch': { stopped: STOP, changed: true },
      'orchestration.workerList': { workers: [] },
      'orchestration.inbox': { messages: [] },
      'game.historyRecord': { recorded: true },
      'terminal.close': (params: Record<string, unknown>) =>
        params.terminal === 'term_2' ? new Error('pty busy') : { close: {} },
      'orchestration.send': { message: { id: 'msg_1' } }
    })

    await run(ORCHESTRATOR_GAME_FLEET_HANDLERS, 'game stop', client, [
      ['all', true],
      ['hold', true]
    ])

    expect(methods().indexOf('game.stopSwitch')).toBeLessThan(methods().indexOf('terminal.close'))
    expect(calls.find(([method]) => method === 'game.stopSwitch')?.[1]).toEqual({
      worktreeId: 'wt1',
      terminalHandle: 'term_lead',
      set: true
    })
    expect(calls.filter(([method]) => method === 'orchestration.send')).toEqual([
      [
        'orchestration.send',
        expect.objectContaining({ to: 'term_2', subject: 'STOP', priority: 'urgent' })
      ]
    ])
    expect(printed()).toEqual(
      expect.objectContaining({ hold: { set: true, stopped: STOP }, told: ['CIN-2'] })
    )
  })

  it('still stops every member when STOP cannot be set, and says so', async () => {
    const { client, methods } = fakeClient({
      'game.state': state(undefined, [LEAD, member('CIN-1', 'term_1')]),
      'game.stopSwitch': new RuntimeClientError('method_not_found', 'Unknown method'),
      'orchestration.workerList': { workers: [] },
      'orchestration.inbox': { messages: [] },
      'game.historyRecord': { recorded: true },
      'terminal.close': { close: {} }
    })

    await run(ORCHESTRATOR_GAME_FLEET_HANDLERS, 'game stop', client, [
      ['all', true],
      ['hold', true]
    ])

    expect(methods()).toContain('terminal.close')
    expect(printed().hold).toEqual({
      set: false,
      reason: expect.stringContaining('does not keep game STOP yet')
    })
    expect(process.exitCode).toBe(1)
  })

  it('refuses --hold without --all', async () => {
    const { client, calls } = fakeClient({})
    await expect(
      run(ORCHESTRATOR_GAME_FLEET_HANDLERS, 'game stop', client, [
        ['tickets', 'CIN-1'],
        ['hold', true]
      ])
    ).rejects.toThrow(/--hold stops the whole project/)
    expect(calls).toEqual([])
  })

  it('refuses launch, wave, push and move while STOP is set, before touching anything', async () => {
    const attempts: [Record<string, CommandHandler>, string, [string, string | boolean][]][] = [
      [ORCHESTRATOR_GAME_LAUNCH_HANDLERS, 'game launch', [['ticket', 'CIN-1']]],
      [ORCHESTRATOR_GAME_FLEET_HANDLERS, 'game wave', []],
      [ORCHESTRATOR_GAME_FLEET_HANDLERS, 'game push', []],
      [ORCHESTRATOR_GAME_MOVE_HANDLERS, 'game move', [['ticket', 'CIN-1']]]
    ]
    for (const [handlers, command, flags] of attempts) {
      const { client, methods } = fakeClient({
        'game.state': state(STOP, [LEAD, member('CIN-1', 'term_1')])
      })
      await expect(run(handlers, command, client, flags)).rejects.toThrow(
        /on STOP since 2026-10-16T10:00:00.000Z \(by lead\).*orca game resume/
      )
      expect(methods()).toEqual(['game.state'])
    }
  })

  it('counts a STOP it cannot read as set', async () => {
    const { client } = fakeClient({
      'game.state': state({ since: null, by: null, unreadable: true })
    })
    await expect(
      run(ORCHESTRATOR_GAME_LAUNCH_HANDLERS, 'game launch', client, [['ticket', 'CIN-1']])
    ).rejects.toThrow(/cannot be read, so it counts as set/)
  })

  it('wave reads STOP again before each launch and leaves the rest unlaunched', async () => {
    let reads = 0
    const { client, methods } = fakeClient({
      'game.state': state(null),
      'game.stopSwitch': () => (++reads > 1 ? { stopped: STOP } : { stopped: null }),
      'worktree.list': { worktrees: [] },
      'terminal.show': { terminal: { handle: 'term_lead' } },
      'orchestration.runCurrent': { run: { id: 'run_1' } },
      'accounts.snapshot': GAME_TEST_ACCOUNTS,
      'orchestration.taskCreate': { task: { id: 'task_1' } },
      'orchestration.workerStart': {
        runId: 'run_1',
        taskId: 'task_1',
        dispatchId: 'd1',
        state: 'ready'
      },
      'game.eventPost': { posted: true }
    })

    await run(ORCHESTRATOR_GAME_FLEET_HANDLERS, 'game wave', client)

    expect(methods().filter((method) => method === 'orchestration.workerStart')).toHaveLength(1)
    expect(printed().launched.map((one: { ticket: string }) => one.ticket)).toEqual(['CIN-1'])
    expect(printed().failed).toEqual([
      { ticket: 'CIN-2', error: expect.stringContaining('on STOP') }
    ])
  })

  it('resume clears STOP and says nothing was relaunched; a failed clear reports STOP still set', async () => {
    const cleared = fakeClient({ 'game.stopSwitch': { stopped: null, changed: true } })
    await run(ORCHESTRATOR_GAME_HOLD_HANDLERS, 'game resume', cleared.client)
    expect(cleared.calls).toEqual([
      ['game.stopSwitch', { worktreeId: 'wt1', terminalHandle: 'term_lead', set: false }]
    ])

    const stuck = fakeClient({ 'game.stopSwitch': new Error('EPERM') })
    await expect(run(ORCHESTRATOR_GAME_HOLD_HANDLERS, 'game resume', stuck.client)).rejects.toThrow(
      'STOP is still set: EPERM'
    )
  })
})
