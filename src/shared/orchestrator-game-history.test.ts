import { describe, expect, it } from 'vitest'
import {
  GAME_HISTORY_MAX,
  appendGameHistory,
  filterGameHistory,
  gameHistoryOutcomeOf,
  parseGameHistoryRecord,
  type GameHistoryRecord
} from './orchestrator-game-history'

const record = (ticket: string, endedAt: string): GameHistoryRecord => ({
  ticket,
  repo: 'cineco',
  branch: ticket.toLowerCase(),
  agent: 'claude',
  account: 'ana@example.com',
  launchedAt: null,
  endedAt,
  outcome: 'merged',
  pr: '#41 merged',
  lastReport: 'Done: seats'
})

describe('game history', () => {
  it('keeps the newest records up to the bound', () => {
    let records: GameHistoryRecord[] = []
    for (let at = 0; at < GAME_HISTORY_MAX + 5; at += 1) {
      records = appendGameHistory(records, record(`CIN-${at}`, new Date(at * 1000).toISOString()))
    }
    expect(records).toHaveLength(GAME_HISTORY_MAX)
    expect(records[0]?.ticket).toBe('CIN-5')
    expect(records.at(-1)?.ticket).toBe(`CIN-${GAME_HISTORY_MAX + 4}`)
  })

  it('filters by ticket and by end time, newest first', () => {
    const records = [
      record('CIN-1', '2026-10-14T10:00:00.000Z'),
      record('CIN-2', '2026-10-15T10:00:00.000Z'),
      record('CIN-1', '2026-10-16T10:00:00.000Z')
    ]
    expect(filterGameHistory(records, { ticket: 'cin-1' }).map((one) => one.endedAt)).toEqual([
      '2026-10-16T10:00:00.000Z',
      '2026-10-14T10:00:00.000Z'
    ])
    expect(filterGameHistory(records, { since: '2026-10-15' }).map((one) => one.ticket)).toEqual([
      'CIN-1',
      'CIN-2'
    ])
  })

  it('names the outcome: merged or QA when swept, limited, failed or stopped when stopped', () => {
    const merged = {
      review: { state: 'merged' as const },
      workItem: { statusGroup: 'done' as const }
    }
    expect(gameHistoryOutcomeOf(merged, 'sweep')).toBe('merged')
    expect(
      gameHistoryOutcomeOf({ ...merged, workItem: { statusGroup: 'review' as const } }, 'sweep')
    ).toBe('qa')
    expect(gameHistoryOutcomeOf({ limit: { resetsAt: null } }, 'stop')).toBe('limited')
    expect(gameHistoryOutcomeOf({}, 'stop', 'failed')).toBe('failed')
    expect(gameHistoryOutcomeOf({}, 'stop', 'ready')).toBe('stopped')
  })

  it('accepts a well-formed record over the wire and refuses the rest', () => {
    const good = record('CIN-1', '2026-10-16T10:00:00.000Z')
    expect(parseGameHistoryRecord(good)).toEqual(good)
    expect(parseGameHistoryRecord({ ...good, outcome: 'exploded' })).toBeNull()
    expect(
      parseGameHistoryRecord({ ...good, lastReport: 'x'.repeat(5000) })?.lastReport
    ).toHaveLength(600)
    expect(parseGameHistoryRecord('CIN-1')).toBeNull()
  })
})
