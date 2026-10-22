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

function fakeClient(fail = false) {
  const calls: [string, unknown][] = []
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      if (fail) {
        throw new RuntimeClientError('method_not_found', `Unknown method: ${method}`)
      }
      const result = method === 'game.events' ? { events: EVENTS } : { records: RECORDS }
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
    expect(metrics.window).toEqual({ since: '2026-10-13', until: null, ticket: null })
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

  it('refuses --character until characters are recorded', async () => {
    const { client, calls } = fakeClient()
    await expect(run(client, [['character', 'Merlin']])).rejects.toThrow(/--character/)
    await expect(run(client, [['character', true]])).rejects.toThrow(/--character/)
    expect(calls).toEqual([])
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
