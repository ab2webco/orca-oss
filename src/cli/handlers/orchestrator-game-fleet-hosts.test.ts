import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatFleet } from './orchestrator-game-fleet-format'
import { ORCHESTRATOR_GAME_FLEET_HANDLERS } from './orchestrator-game-fleet'
import { gameFleetReportOf } from '../../shared/orchestrator-game-fleet-verbs'
import {
  LEAD,
  fakeClient,
  member,
  methods,
  run,
  stateWith
} from './orchestrator-game-fleet-test-fixtures'

describe('orca game fleet across paired hosts (ORCA-888)', () => {
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
})

const GB = 1024 ** 3

describe('orca game fleet per host (ORCA-841)', () => {
  const saved = { ...process.env }
  let output: string[] = []

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
  })

  const hostCapacity = [
    {
      host: 'local',
      running: 1,
      cap: 4,
      status: 'ok',
      cpuCoreCount: 10,
      totalMemory: 16 * GB,
      availableMemory: 9 * GB,
      loadAverage1m: 2.1
    },
    { host: 'm1', running: 0, status: 'unreachable' }
  ]
  const hosts = [
    { host: 'local', cap: 4, status: 'ok' },
    { host: 'm1', id: 'env-m1', cap: 0, status: 'unreachable' }
  ]

  it('gives each host its own line, in place of the one-line Hosts, with its cap', async () => {
    const { client } = fakeClient(stateWith({ agents: [LEAD, member({})], hosts, hostCapacity }))

    await ORCHESTRATOR_GAME_FLEET_HANDLERS['game fleet']({
      flags: new Map(),
      client,
      cwd: '/repo',
      json: false
    })

    expect(output.join('\n').split('\n').slice(1, 4)).toEqual([
      'Hosts:',
      '  local  1/4 running · 10 cores · 9.0 of 16 GB free · load 2.1',
      '  m1     0 running · not answering'
    ])
  })

  it('carries the rows in --json, and prints no host lines without them', async () => {
    const { client } = fakeClient(stateWith({ agents: [LEAD, member({})], hostCapacity }))
    await run('game fleet', client)
    expect(JSON.parse(output.join('')).result.hostCapacity).toEqual(hostCapacity)

    output = []
    const { client: alone } = fakeClient(stateWith({ agents: [LEAD, member({})] }))
    await ORCHESTRATOR_GAME_FLEET_HANDLERS['game fleet']({
      flags: new Map(),
      client: alone,
      cwd: '/repo',
      json: false
    })
    expect(output.join('\n')).not.toContain('Hosts:')
  })
})
