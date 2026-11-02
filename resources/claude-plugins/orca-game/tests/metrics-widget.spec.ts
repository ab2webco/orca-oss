import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { gameStateOf } from '../hooks/game-state'
import { setGameLocale } from '../hooks/game-strings'
import { metricsWords } from '../hooks/metrics-words'
import {
  accountLinesOf,
  leadTimeOf,
  mergedAxisOf,
  mergedBarsOf,
  mergedStatsOf,
  meterOf
} from '../hooks/metrics-widget'
import { cellWidthOf } from '../hooks/cell-width'
import { parseGameEvent } from '../../../../src/shared/orchestrator-game-events'
import { parseGameHistoryRecord } from '../../../../src/shared/orchestrator-game-history'
import { computeGameMetrics } from '../../../../src/shared/orchestrator-game-metrics'
import {
  gameDayWindowOf,
  gameMetricsSummaryOf
} from '../../../../src/shared/orchestrator-game-metrics-summary'

// Why recorded: the host's summary of this project's real stores, as `orca game state` sends it.
const recorded = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../src/shared/__tests__/fixtures/orchestrator-game-recorded-stores.json'
    ),
    'utf8'
  )
) as { recordedAt: string; events: unknown[]; history: unknown[] }
const stores = {
  events: recorded.events.map(parseGameEvent).filter((one) => one !== null),
  history: recorded.history.map(parseGameHistoryRecord).filter((one) => one !== null)
}
const summary = gameMetricsSummaryOf(stores, {
  now: Date.parse(recorded.recordedAt),
  timezone: 'America/Bogota'
})
const accounts = [
  { email: 'lead@example.com', active: true, sessionPercent: 41, weeklyPercent: 12 },
  { email: 'spare@example.com', active: false, sessionPercent: null, weeklyPercent: 96 }
]
const stateWith = (metrics: unknown) =>
  gameStateOf({ config: {}, warnings: [], agents: [], metrics })
const textOf = (lines: ReturnType<typeof accountLinesOf>) =>
  lines.map((line) => line.parts.map((part) => part.text).join(''))

afterEach(() => {
  setGameLocale('en')
})

describe('metrics in the game state', () => {
  it("keeps the host's days, lead time and accounts", () => {
    const metrics = stateWith({ ...summary, claudeAccounts: accounts })?.metrics
    expect(metrics?.mergedPerDay).toEqual(summary.mergedPerDay)
    expect(metrics?.leadTime).toEqual(summary.leadTime)
    expect(metrics?.claudeAccounts).toEqual(accounts)
  })

  it('survives being read back from the state this mod stored', () => {
    const stored = stateWith({ ...summary, claudeAccounts: accounts })
    expect(gameStateOf(stored)?.metrics).toEqual(stored?.metrics)
  })

  it('leaves them out from an older host, a member, or a damaged value', () => {
    expect('metrics' in (stateWith(undefined) ?? {})).toBe(false)
    expect('metrics' in (stateWith({ mergedPerDay: 'x', leadTime: {} }) ?? {})).toBe(false)
    expect('metrics' in (stateWith({ mergedPerDay: [], leadTime: {} }) ?? {})).toBe(false)
  })

  it('drops a day or account it cannot read and keeps the rest', () => {
    const metrics = stateWith({
      mergedPerDay: [
        { day: '2026-10-29', merged: -1 },
        { day: '2026-10-30', merged: 2 }
      ],
      leadTime: { medianMs: 'soon', measured: 1 },
      claudeAccounts: [{ email: 7 }, { ...accounts[0], sessionPercent: 140 }]
    })?.metrics
    expect(metrics?.mergedPerDay).toEqual([{ day: '2026-10-30', merged: 2 }])
    expect(metrics?.leadTime).toEqual({ medianMs: null, measured: 1 })
    expect(metrics?.claudeAccounts).toEqual([{ ...accounts[0], sessionPercent: 100 }])
  })
})

describe('the metrics widget', () => {
  it('fills a meter by eighths of a cell', () => {
    expect(meterOf(0, 4)).toBe('░░░░')
    expect(meterOf(50, 4)).toBe('██░░')
    expect(meterOf(41, 4)).toBe('█▋░░')
    expect(meterOf(100, 4)).toBe('████')
  })

  it('draws one bar per recorded day, and the totals match orca game metrics over that window', () => {
    const metrics = stateWith(summary)!.metrics!
    const first = gameDayWindowOf(summary.mergedPerDay[0]!.day, 'America/Bogota').since
    const until = gameDayWindowOf(summary.mergedPerDay.at(-1)!.day, 'America/Bogota').until
    const cli = computeGameMetrics(stores, { since: first, until })
    expect(mergedStatsOf(metrics.mergedPerDay).total).toBe(cli.ticketsDone.length)
    expect(mergedBarsOf([0, 1, 2], 40).rows).toHaveLength(3)
    expect(leadTimeOf(metrics)).toEqual({
      value: expect.stringMatching(/^\d+[dhm]( \d+[hm])?$/),
      measured: summary.leadTime.measured
    })
  })

  it('stacks eighth blocks three rows tall, the tallest day full and a zero a floor', () => {
    const bars = mergedBarsOf([0, 4, 8], 40)
    expect(bars).toMatchObject({ width: 8, cells: 2, gap: 1 })
    expect(bars.rows).toEqual(['      ██', '   ▄▄ ██', '▁▁ ██ ██'])
  })

  it('narrows the bars to fit the card, two cells then one, never past its width', () => {
    const days = Array.from({ length: 14 }, (_one, at) => at)
    expect(mergedBarsOf(days, 41)).toMatchObject({ cells: 2, gap: 1, width: 41 })
    expect(mergedBarsOf(days, 30)).toMatchObject({ cells: 2, gap: 0, width: 28 })
    expect(mergedBarsOf(days, 20)).toMatchObject({ cells: 1, gap: 0, width: 14 })
    for (const room of [10, 20, 30, 41, 60]) {
      for (const row of mergedBarsOf(days, room).rows) {
        expect(cellWidthOf(row), `${room}`).toBeLessThanOrEqual(room)
      }
    }
  })

  it('labels the first and last day under the bars, and sums total, average and peak', () => {
    const days = [
      { day: '2026-10-20', merged: 2 },
      { day: '2026-10-21', merged: 0 },
      { day: '2026-11-02', merged: 9 }
    ]
    expect(mergedAxisOf(days, 20)).toBe('10-20          11-02')
    expect(mergedAxisOf(days, 8)).toBe('')
    expect(mergedStatsOf(days)).toEqual({ total: 11, perDay: '3.7', peak: 9 })
  })

  it('says when no ticket was measured', () => {
    const metrics = stateWith({ ...summary, leadTime: { medianMs: null, measured: 0 } })!.metrics!
    expect(leadTimeOf(metrics)).toEqual({ value: null, measured: 0 })
  })

  it('puts each account on one row when wide and two when narrow, the active one marked', () => {
    const metrics = stateWith({ ...summary, claudeAccounts: accounts })!.metrics!
    const wide = textOf(accountLinesOf(metrics.claudeAccounts, 80))
    expect(wide).toContain(
      `● lead@example.com   5h ${meterOf(41, 12)}  41%  7d ${meterOf(12, 12)}  12%`
    )
    const narrow = textOf(accountLinesOf(metrics.claudeAccounts, 36))
    expect(narrow).toContain('● lead@example.com')
    expect(narrow).toContain(`  5h ${meterOf(41, 8)}  41%  7d ${meterOf(12, 8)}  12%`)
  })

  it('gives a long email its own row rather than cutting it to keep one row', () => {
    const long = [
      { email: 'fabian.altahona@koombea.com', active: true, sessionPercent: 42, weeklyPercent: 71 }
    ]
    const rows = textOf(accountLinesOf(long, 38))
    expect(rows[0]).toBe('● fabian.altahona@koombea.com')
    expect(rows[1]).toBe(`  5h ${meterOf(42, 9)}  42%  7d ${meterOf(71, 9)}  71%`)
  })

  it('narrows the meters so an account row never wraps on a phone', () => {
    const metrics = stateWith({ ...summary, claudeAccounts: accounts })!.metrics!
    for (const columns of [24, 28, 32, 36, 80]) {
      const rows = accountLinesOf(metrics.claudeAccounts, columns)
      expect(
        Math.max(...textOf(rows).map((one) => cellWidthOf(one))),
        `${columns}`
      ).toBeLessThanOrEqual(columns)
    }
    expect(textOf(accountLinesOf(metrics.claudeAccounts, 28))).toContain(
      '  5h █▋░░  41%  7d ▌░░░  12%'
    )
  })

  it('warns in red on an account near its limit, and draws the empty track apart', () => {
    const metrics = stateWith({ ...summary, claudeAccounts: accounts })!.metrics!
    const spare = accountLinesOf(metrics.claudeAccounts, 80).find(
      (line) => line.key === 'account-1'
    )
    expect(spare?.parts.find((part) => part.text.includes('96%'))?.tone).toBe('danger')
    expect(spare?.parts.find((part) => /^░+$/.test(part.text))?.tone).toBe('track')
  })

  it('speaks Spanish', () => {
    setGameLocale('es')
    expect(metricsWords().mergedTitle).toBe('Fusionados por día')
    expect(metricsWords().measured(1)).toBe('1 ticket medido')
  })
})
