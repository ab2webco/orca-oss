import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_FLEET_HANDLERS } from './orchestrator-game-fleet'
import { LEAD, fakeClient, member, run, stateWith } from './orchestrator-game-fleet-test-fixtures'

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
      status: 'ok',
      cpuCoreCount: 10,
      totalMemory: 16 * GB,
      availableMemory: 9 * GB,
      loadAverage1m: 2.1
    },
    { host: 'm1', running: 0, status: 'unreachable' }
  ]

  it('prints the members, cores, free memory and load of each host under its head', async () => {
    const { client } = fakeClient(stateWith({ agents: [LEAD, member({})], hostCapacity }))

    await ORCHESTRATOR_GAME_FLEET_HANDLERS['game fleet']({
      flags: new Map(),
      client,
      cwd: '/repo',
      json: false
    })

    expect(output.join('\n').split('\n').slice(1, 4)).toEqual([
      'Hosts:',
      '  local  1 running · 10 cores · 9.0 of 16 GB free · load 2.1',
      '  m1     0 running · not answering'
    ])
  })

  it('carries the rows in --json, and prints no Hosts line without them', async () => {
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
