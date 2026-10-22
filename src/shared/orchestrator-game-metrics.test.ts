import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeGameMetrics, GAME_METRICS_NOT_RECORDED } from './orchestrator-game-metrics'
import { GAME_EVENTS_MAX, type GameEvent, type GameEventKind } from './orchestrator-game-events'
import { GAME_HISTORY_MAX, type GameHistoryRecord } from './orchestrator-game-history'

const event = (at: string, kind: GameEventKind, ticket: string | null): GameEvent => ({
  at,
  kind,
  ticket,
  text: null,
  by: 'lead'
})

const record = (
  ticket: string | null,
  outcome: GameHistoryRecord['outcome'],
  endedAt: string,
  extra: Partial<GameHistoryRecord> = {}
): GameHistoryRecord => ({
  ticket,
  repo: 'orca-oss',
  branch: null,
  agent: 'claude',
  account: null,
  launchedAt: null,
  endedAt,
  outcome,
  pr: null,
  lastReport: null,
  ...extra
})

// Shaped like orca-oss's record: newest first, relaunches, zoneless launchedAt from SQLite.
const EVENTS: GameEvent[] = [
  event('2026-10-20T15:00:00.000Z', 'merged', 'ORCA-3'),
  event('2026-10-20T10:00:00.000Z', 'claimed', 'ORCA-3'),
  event('2026-10-19T12:30:00.000Z', 'merged', 'ORCA-1'),
  event('2026-10-19T11:00:00.000Z', 'failed', 'ORCA-2'),
  event('2026-10-19T09:00:00.000Z', 'pr_opened', 'ORCA-1'),
  event('2026-10-19T08:00:00.000Z', 'claimed', 'ORCA-2'),
  event('2026-10-18T10:00:00.000Z', 'claimed', 'ORCA-1'),
  event('2026-10-18T09:00:00.000Z', 'merged', null),
  event('2026-10-12T08:00:00.000Z', 'claimed', 'ORCA-1')
]

const HISTORY: GameHistoryRecord[] = [
  record('ORCA-4', 'merged', '2026-10-20T08:00:00.000Z', {
    launchedAt: '2026-10-20 02:00:00',
    pr: '#9 merged'
  }),
  record('ORCA-3', 'merged', '2026-10-20T15:05:00.000Z', { pr: '#8 merged' }),
  record('ORCA-5', 'stopped', '2026-10-19T20:00:00.000Z', { pr: '#7 merged' }),
  record('ORCA-2', 'failed', '2026-10-19T11:05:00.000Z'),
  record('ORCA-1', 'qa', '2026-10-19T12:35:00.000Z', { pr: '#6 merged' }),
  record('ORCA-0', 'merged', '2026-10-10T08:00:00.000Z')
]

const HOUR = 3_600_000

describe('computeGameMetrics', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('counts each done ticket once, from merged events and merged history', () => {
    const metrics = computeGameMetrics({ events: EVENTS, history: HISTORY }, {})

    // ORCA-1 and ORCA-3 by event, ORCA-4 by outcome, ORCA-5 by its merged PR, ORCA-0 by outcome.
    expect(metrics.ticketsDone).toEqual(['ORCA-0', 'ORCA-1', 'ORCA-3', 'ORCA-4', 'ORCA-5'])
  })

  it('measures lead time from the first claim to the last merge, per ticket', () => {
    // Why a zone: on a UTC runner, reading launchedAt as local time would pass unnoticed.
    vi.stubEnv('TZ', 'America/Bogota')
    const metrics = computeGameMetrics(
      { events: EVENTS, history: HISTORY },
      { since: '2026-10-13' }
    )

    expect(metrics.ticketsDone).toEqual(['ORCA-1', 'ORCA-3', 'ORCA-4', 'ORCA-5'])
    // ORCA-1 claimed 10-12 08:00 (before the window, still its claim), merged 10-19 12:30.
    // ORCA-4 has no claim event: its launchedAt is UTC, so 02:00 to 08:00 is 6 h.
    expect(metrics.leadTime.tickets).toEqual([
      {
        ticket: 'ORCA-1',
        claimedAt: '2026-10-12T08:00:00.000Z',
        mergedAt: '2026-10-19T12:30:00.000Z',
        endsAt: 'merged_event',
        ms: 172.5 * HOUR,
        claims: 2
      },
      {
        ticket: 'ORCA-3',
        claimedAt: '2026-10-20T10:00:00.000Z',
        mergedAt: '2026-10-20T15:00:00.000Z',
        endsAt: 'merged_event',
        ms: 5 * HOUR,
        claims: 1
      },
      {
        ticket: 'ORCA-4',
        claimedAt: '2026-10-20T02:00:00.000Z',
        mergedAt: '2026-10-20T08:00:00.000Z',
        endsAt: 'member_freed',
        ms: 6 * HOUR,
        claims: 0
      }
    ])
    expect(metrics.leadTime.unmeasured).toEqual(['ORCA-5'])
    expect(metrics.leadTime.medianMs).toBe(6 * HOUR)
    expect(metrics.leadTime.meanMs).toBe(((172.5 + 5 + 6) / 3) * HOUR)
  })

  it('counts outcomes and events inside the window only', () => {
    const metrics = computeGameMetrics(
      { events: EVENTS, history: HISTORY },
      { since: '2026-10-19', until: '2026-10-20' }
    )

    expect(metrics.outcomes).toEqual({ merged: 0, qa: 1, stopped: 1, failed: 1, limited: 0 })
    expect(metrics.events).toEqual({
      claimed: 1,
      pr_opened: 1,
      merged: 1,
      qa_handoff: 0,
      question_parked: 0,
      failed: 1,
      stopped: 0,
      resumed: 0
    })
    expect(metrics.ticketsDone).toEqual(['ORCA-1', 'ORCA-5'])
  })

  it('keeps an entry at since and drops one at until', () => {
    const metrics = computeGameMetrics(
      { events: EVENTS, history: [] },
      { since: '2026-10-20T10:00:00.000Z', until: '2026-10-20T15:00:00.000Z' }
    )

    expect(metrics.events.claimed).toBe(1)
    expect(metrics.events.merged).toBe(0)
  })

  it('narrows to one ticket', () => {
    const metrics = computeGameMetrics({ events: EVENTS, history: HISTORY }, { ticket: 'orca-1' })

    expect(metrics.ticketsDone).toEqual(['ORCA-1'])
    expect(metrics.events.claimed).toBe(2)
    expect(metrics.outcomes.qa).toBe(1)
    expect(metrics.window.ticket).toBe('ORCA-1')
  })

  it('reports an empty window as zero counts and no lead time', () => {
    const metrics = computeGameMetrics(
      { events: EVENTS, history: HISTORY },
      { since: '2026-11-01' }
    )

    expect(metrics.ticketsDone).toEqual([])
    expect(metrics.leadTime).toEqual({ tickets: [], unmeasured: [], medianMs: null, meanMs: null })
  })

  it('leaves a merge before its claim unmeasured', () => {
    const metrics = computeGameMetrics(
      {
        events: [
          event('2026-10-20T10:00:00.000Z', 'claimed', 'ORCA-9'),
          event('2026-10-20T09:00:00.000Z', 'merged', 'ORCA-9')
        ],
        history: []
      },
      {}
    )

    expect(metrics.leadTime.unmeasured).toEqual(['ORCA-9'])
  })

  it('lists every metric without a recorded fact as not recorded, never as a number', () => {
    const metrics = computeGameMetrics({ events: [], history: [] }, {})

    expect(metrics.notRecorded.map((one) => one.metric)).toEqual([
      'firstTimeGreenRate',
      'rework',
      'averagePrSize',
      'cleanupCompliance',
      'trackerDrift',
      'xp',
      'achievements'
    ])
    expect(metrics.notRecorded).toBe(GAME_METRICS_NOT_RECORDED)
  })

  it('says a full store whose oldest entry is inside the window may have lost the start', () => {
    const full = Array.from({ length: GAME_EVENTS_MAX }, (_, index) =>
      event(new Date(Date.UTC(2026, 9, 20, 0, index)).toISOString(), 'claimed', 'ORCA-1')
    )
    const fullHistory = Array.from({ length: GAME_HISTORY_MAX }, () =>
      record('ORCA-1', 'stopped', '2026-10-20T00:00:00.000Z')
    )

    expect(
      computeGameMetrics({ events: full, history: fullHistory }, { since: '2026-10-19' }).truncated
    ).toEqual({ events: true, history: true })
    expect(
      computeGameMetrics({ events: full, history: fullHistory }, { since: '2026-10-21' }).truncated
    ).toEqual({ events: false, history: false })
    expect(computeGameMetrics({ events: EVENTS, history: HISTORY }, {}).truncated).toEqual({
      events: false,
      history: false
    })
  })
})
