import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatGameMetrics, ORCHESTRATOR_GAME_METRICS_HANDLERS } from './orchestrator-game-metrics'
import { computeGameMetrics } from '../../shared/orchestrator-game-metrics'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

const EVENTS = [
  { at: '2026-10-20T15:00:00.000Z', kind: 'merged', ticket: 'CIN-3', text: null, by: 'orca' },
  { at: '2026-10-20T13:00:00.000Z', kind: 'renamed', ticket: 'CIN-3', text: null, by: 'orca' },
  { at: '2026-10-20T10:00:00.000Z', kind: 'claimed', ticket: 'CIN-3', text: null, by: 'lead' },
  { at: '2026-10-12T10:00:00.000Z', kind: 'claimed', ticket: 'CIN-1', text: null, by: 'lead' }
]
const RECORDS = [
  {
    ticket: 'CIN-1',
    repo: 'cineco',
    branch: null,
    agent: 'claude',
    account: null,
    launchedAt: null,
    endedAt: '2026-10-19T12:00:00.000Z',
    outcome: 'stopped',
    pr: '#41 merged',
    lastReport: null
  }
]

// Luigi stopped CIN-3 after Peach merged CIN-1; Peach's first task is no longer kept.
const CHARACTERS = [
  {
    key: 'peach',
    name: 'Peach',
    tickets: 2,
    prsOpened: 1,
    prsMerged: 1,
    outcomes: { merged: 2, qa: 0, stopped: 0, failed: 0, limited: 0 },
    workedMs: 0,
    xp: 200,
    lastAt: '2026-10-19T12:00:00.000Z',
    recent: [
      {
        ticket: 'CIN-1',
        outcome: 'merged',
        pr: '#41 merged',
        endedAt: '2026-10-19T12:00:00.000Z',
        workedMs: null
      }
    ]
  },
  {
    key: 'luigi',
    name: 'Luigi',
    tickets: 1,
    prsOpened: 0,
    prsMerged: 0,
    outcomes: { merged: 0, qa: 0, stopped: 1, failed: 0, limited: 0 },
    workedMs: 0,
    xp: 0,
    lastAt: '2026-10-20T12:00:00.000Z',
    recent: [
      {
        ticket: 'CIN-3',
        outcome: 'stopped',
        pr: null,
        endedAt: '2026-10-20T12:00:00.000Z',
        workedMs: null
      }
    ]
  }
]

function fakeClient(fail = false, characters: unknown[] | 'unknown' = CHARACTERS) {
  const calls: [string, unknown][] = []
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      if (fail || (method === 'game.characters' && characters === 'unknown')) {
        throw new RuntimeClientError('method_not_found', `Unknown method: ${method}`)
      }
      const result =
        method === 'game.events'
          ? { events: EVENTS }
          : method === 'game.characters'
            ? { characters }
            : { records: RECORDS }
      return { id: '1', ok: true, result, _meta: { runtimeId: 'rt' } }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const run = (client: RuntimeClient, flags: [string, string | boolean][], json = true) =>
  ORCHESTRATOR_GAME_METRICS_HANDLERS['game metrics']({
    flags: new Map(flags),
    client,
    cwd: '/repo',
    json
  })

describe('orca game metrics', () => {
  const saved = { ...process.env }
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
  })

  it('reads the whole stores, so a claim before --since still starts its lead time', async () => {
    const { client, calls } = fakeClient()

    await run(client, [['since', '2026-10-13']])

    const caller = { worktreeId: 'wt1', terminalHandle: 'term_lead' }
    expect(calls).toEqual([
      ['game.events', caller],
      ['game.history', caller]
    ])
    const metrics = JSON.parse(output.join('')).result
    expect(metrics.ticketsDone).toEqual(['CIN-1', 'CIN-3'])
    expect(metrics.leadTime.tickets.map((one: { ticket: string }) => one.ticket)).toEqual([
      'CIN-1',
      'CIN-3'
    ])
    expect(metrics.window).toEqual({
      since: '2026-10-13',
      until: null,
      ticket: null,
      character: null
    })
  })

  it('drops an event kind it does not know instead of counting it', async () => {
    const { client } = fakeClient()

    await run(client, [])

    const metrics = JSON.parse(output.join('')).result
    expect(metrics.events).not.toHaveProperty('renamed')
    expect(metrics.events.claimed).toBe(2)
  })

  it('narrows to --ticket and --until', async () => {
    const { client } = fakeClient()

    await run(client, [
      ['ticket', 'cin-3'],
      ['until', '2026-10-20T12:00Z']
    ])

    const metrics = JSON.parse(output.join('')).result
    expect(metrics.window.ticket).toBe('CIN-3')
    expect(metrics.ticketsDone).toEqual([])
    expect(metrics.events.claimed).toBe(1)
  })

  it.each(['since', 'until'])('refuses a --%s it cannot read', async (flag) => {
    const { client, calls } = fakeClient()
    await expect(run(client, [[flag, 'last-week-ish']])).rejects.toThrow(`--${flag}`)
    expect(calls).toEqual([])
  })

  it("narrows --character to that character's own tasks, by name in any case", async () => {
    const { client, calls } = fakeClient()

    await run(client, [['character', 'luigi']])

    const caller = { worktreeId: 'wt1', terminalHandle: 'term_lead' }
    expect(calls[0]).toEqual(['game.characters', caller])
    const metrics = JSON.parse(output.join('')).result
    expect(metrics.window.character).toBe('Luigi')
    // CIN-3 was merged, but by its event alone; Luigi's own task on it was stopped.
    expect(metrics.ticketsDone).toEqual([])
    expect(metrics.outcomes.stopped).toBe(1)
    expect(metrics.character).toMatchObject({ name: 'Luigi', xp: 0, tasksKept: 1 })
  })

  it('refuses an unknown character and names the ones it knows', async () => {
    const { client, calls } = fakeClient()

    await expect(run(client, [['character', 'Merlin']])).rejects.toThrow(
      'No character "Merlin" in this project. Known: Peach, Luigi.'
    )
    expect(calls.map(([method]) => method)).toEqual(['game.characters'])
  })

  it('refuses --character without a name, and when no character is recorded yet', async () => {
    const empty = fakeClient(false, [])
    await expect(run(empty.client, [['character', true]])).rejects.toThrow(
      '--character needs a name'
    )
    expect(empty.calls).toEqual([])
    await expect(run(empty.client, [['character', 'Peach']])).rejects.toThrow(
      'No character has been recorded in this project yet'
    )
  })

  it('maps an Orca without game characters to incompatible_runtime, only for --character', async () => {
    const { client, calls } = fakeClient(false, 'unknown')

    await expect(run(client, [['character', 'Peach']])).rejects.toMatchObject({
      code: 'incompatible_runtime'
    })
    await run(client, [])
    expect(calls.filter(([method]) => method === 'game.characters')).toHaveLength(1)
  })

  it("prints the character's level and says when its oldest tasks are no longer kept", async () => {
    const { client } = fakeClient()

    await run(client, [['character', 'Peach']], false)

    const text = output.join('\n')
    expect(text).toContain('Game metrics · all recorded time · all tickets · Peach')
    expect(text).toContain('Character      Peach · level 2 · 200 XP')
    expect(text).toContain(
      "Note: only Peach's last 1 of 2 tasks are kept; older ones do not count."
    )
    expect(text).not.toMatch(/^ +XP +not recorded/m)
    expect(Math.max(...text.split('\n').map((line) => line.length))).toBeLessThanOrEqual(80)
  })

  it('maps an Orca without game events or history to incompatible_runtime', async () => {
    const { client } = fakeClient(true)
    await expect(run(client, [])).rejects.toMatchObject({ code: 'incompatible_runtime' })
  })

  it('prints a summary that fits 80 columns and says not recorded, never 0', async () => {
    const { client } = fakeClient()

    await run(client, [['since', '2026-10-13']], false)

    const text = output.join('\n')
    expect(text).toContain('Tickets done   2 · CIN-1 · CIN-3')
    expect(text).toContain('Lead time      median 3d 15h · mean 3d 15h · 2 measured')
    expect(text).toContain('first-time-green rate  not recorded')
    expect(text).toMatch(/^  CIN-1 +7d 02h · ends when freed$/m)
    expect(text).toMatch(/^  CIN-3 +5h 00m$/m)
    expect(text).not.toMatch(/first-time-green rate\s+0/)
    expect(Math.max(...text.split('\n').map((line) => line.length))).toBeLessThanOrEqual(80)
  })

  it('prints the last 14 days the scene widget draws, from the same summary', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-21T12:00:00.000Z'), toFake: ['Date'] })
    const { client } = fakeClient()

    await run(client, [['timezone', 'UTC']])
    const daily = JSON.parse(output.join('')).result.daily
    output = []
    await run(client, [['timezone', 'UTC']], false)
    vi.useRealTimers()

    expect(daily.timezone).toBe('UTC')
    expect(daily.mergedPerDay.at(-1)).toEqual({ day: '2026-10-21', merged: 0 })
    expect(daily.mergedPerDay.find((one: { day: string }) => one.day === '2026-10-20')).toEqual({
      day: '2026-10-20',
      merged: 1
    })
    const text = output.join('\n')
    expect(text).toContain('Last 14 days   to 2026-10-21 UTC · 2 merged · lead time median 3d 15h')
    expect(text).toMatch(/^Merged per day 10-08 0 · /m)
    expect(text).toMatch(/10-19 1\n {15}10-20 1 · 10-21 0$/m)
    expect(Math.max(...text.split('\n').map((line) => line.length))).toBeLessThanOrEqual(80)
  })

  it('leaves the 14 days out of a filtered query, whose window is its own', async () => {
    const { client } = fakeClient()
    await run(client, [['since', '2026-10-13']])
    expect(JSON.parse(output.join('')).result).not.toHaveProperty('daily')
  })

  it('refuses a zone the runtime does not know', async () => {
    const { client } = fakeClient()
    await expect(run(client, [['timezone', 'Mars/Olympus']])).rejects.toMatchObject({
      code: 'invalid_argument'
    })
  })

  it('says when the stores no longer reach the start of the window', () => {
    const metrics = {
      ...computeGameMetrics({ events: [], history: [] }, {}),
      truncated: { events: true, history: true }
    }

    const lines = formatGameMetrics(metrics).split('\n')

    expect(lines).toContain('Lead time      no data')
    expect(lines.filter((line) => line.startsWith('Note: only the last'))).toHaveLength(2)
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(80)
  })
})
