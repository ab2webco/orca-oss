import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { gameStateOf } from '../hooks/game-state'
import { setGameLocale } from '../hooks/game-strings'
import { meterOf, metricsLinesOf, sparklineOf } from '../hooks/metrics-widget'
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
const textOf = (lines: ReturnType<typeof metricsLinesOf>) =>
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
  it('draws a day with no merges lowest and the busiest day full', () => {
    expect(sparklineOf([0, 1, 2, 4, 8])).toBe('▁▂▃▅█')
    expect(sparklineOf([0, 0])).toBe('▁▁')
  })

  it('fills a meter by eighths of a cell', () => {
    expect(meterOf(0, 4)).toBe('░░░░')
    expect(meterOf(50, 4)).toBe('██░░')
    expect(meterOf(41, 4)).toBe('█▋░░')
    expect(meterOf(100, 4)).toBe('████')
  })

  it('draws one bar per recorded day, and the totals match orca game metrics over that window', () => {
    const metrics = stateWith(summary)?.metrics
    const [days, axis, lead] = textOf(metricsLinesOf(metrics!, 80))
    const first = gameDayWindowOf(summary.mergedPerDay[0]!.day, 'America/Bogota').since
    const until = gameDayWindowOf(summary.mergedPerDay.at(-1)!.day, 'America/Bogota').until
    const cli = computeGameMetrics(stores, { since: first, until })
    expect(days).toBe(
      `${sparklineOf(summary.mergedPerDay.map((one) => one.merged))} ${cli.ticketsDone.length} merged · 14 days`
    )
    expect(axis).toMatch(/^\d\d-\d\d +\d\d-\d\d$/)
    expect(lead).toMatch(
      new RegExp(`^lead time median \\d+[dhm]( \\d+[hm])? · ${summary.leadTime.measured} tickets$`)
    )
  })

  it('puts each account on one row when wide and two when narrow, the active one marked', () => {
    const metrics = stateWith({ ...summary, claudeAccounts: accounts })!.metrics!
    const wide = textOf(metricsLinesOf(metrics, 80))
    expect(wide).toContain('● lead@example.com   5h ██▌░░░  41%  7d ▊░░░░░  12%')
    expect(wide).toContain('○ spare@example.com  5h ░░░░░░    —  7d █████▊  96%')
    const narrow = textOf(metricsLinesOf(metrics, 36))
    expect(narrow).toContain('● lead@example.com')
    expect(narrow).toContain('  5h ██▌░░░  41%  7d ▊░░░░░  12%')
  })

  it('narrows the meters so an account row never wraps on a phone', () => {
    const metrics = stateWith({ ...summary, claudeAccounts: accounts })!.metrics!
    for (const columns of [24, 28, 32]) {
      const rows = metricsLinesOf(metrics, columns).filter((one) => one.key.startsWith('account'))
      expect(Math.max(...textOf(rows).map((one) => one.length))).toBeLessThanOrEqual(columns)
    }
    expect(textOf(metricsLinesOf(metrics, 28))).toContain('  5h █▋░░  41%  7d ▌░░░  12%')
  })

  it('warns in red on an account near its limit', () => {
    const metrics = stateWith({ ...summary, claudeAccounts: accounts })!.metrics!
    const spare = metricsLinesOf(metrics, 80).find((line) => line.key === 'account-1')
    expect(spare?.parts.find((part) => part.text.includes('96%'))?.tone).toBe('danger')
  })

  it('speaks Spanish', () => {
    setGameLocale('es')
    const [days, , lead] = textOf(metricsLinesOf(stateWith(summary)!.metrics!, 80))
    expect(days).toMatch(/ \d+ fusionados · 14 días$/)
    expect(lead).toMatch(/^mediana de entrega \d+[dhm]( \d+[hm])? · \d+ tickets$/)
  })
})
