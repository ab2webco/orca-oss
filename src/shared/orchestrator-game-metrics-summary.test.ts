import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseGameEvent } from './orchestrator-game-events'
import { parseGameHistoryRecord } from './orchestrator-game-history'
import { computeGameMetrics } from './orchestrator-game-metrics'
import { GAME_CLAUDE_ACCOUNTS_MAX } from './orchestrator-game-claude-usage'
import {
  GAME_METRICS_COMPUTE_BUDGET_MS,
  GAME_METRICS_DAYS,
  GAME_METRICS_PAYLOAD_BUDGET_BYTES,
  gameDayWindowOf,
  gameMetricsSummaryOf
} from './orchestrator-game-metrics-summary'

// Why recorded: this project's real game.events and game.history on 2026-10-30, `text` and accounts blanked.
const recorded = JSON.parse(
  readFileSync(
    join(__dirname, '__tests__', 'fixtures', 'orchestrator-game-recorded-stores.json'),
    'utf8'
  )
) as { recordedAt: string; events: unknown[]; history: unknown[] }
const stores = {
  events: recorded.events.map(parseGameEvent).filter((one) => one !== null),
  history: recorded.history.map(parseGameHistoryRecord).filter((one) => one !== null)
}
const now = Date.parse(recorded.recordedAt)
const timezone = 'America/Bogota'

describe('gameDayWindowOf', () => {
  it('spans one calendar day in the zone', () => {
    expect(gameDayWindowOf('2026-10-30', 'America/Bogota')).toEqual({
      since: '2026-10-30T05:00:00.000Z',
      until: '2026-10-31T05:00:00.000Z'
    })
  })

  it('is 25 hours on the day daylight saving ends', () => {
    expect(gameDayWindowOf('2026-11-01', 'America/New_York')).toEqual({
      since: '2026-11-01T04:00:00.000Z',
      until: '2026-11-02T05:00:00.000Z'
    })
  })
})

describe('gameMetricsSummaryOf', () => {
  it('reads the recorded stores', () => {
    expect(stores.events).toHaveLength(recorded.events.length)
    expect(stores.history).toHaveLength(recorded.history.length)
  })

  it('counts each ticket once, on the day `orca game metrics` says it was done', () => {
    const summary = gameMetricsSummaryOf(stores, { now, timezone })
    expect(summary.mergedPerDay).toHaveLength(GAME_METRICS_DAYS)
    expect(summary.mergedPerDay.at(-1)?.day).toBe('2026-10-30')
    expect(summary.mergedPerDay[0].day).toBe('2026-10-17')
    const cli = computeGameMetrics(stores, { since: gameDayWindowOf('2026-10-17', timezone).since })
    const total = summary.mergedPerDay.reduce((sum, one) => sum + one.merged, 0)
    expect(total).toBeGreaterThan(0)
    expect(total).toBe(cli.ticketsDone.length)
    for (const { day, merged } of summary.mergedPerDay) {
      const { since, until } = gameDayWindowOf(day, timezone)
      const doneThatDay = Object.values(cli.ticketsDoneAt).filter((at) => at >= since && at < until)
      expect(merged, day).toBe(doneThatDay.length)
    }
  })

  it('does not count a ticket again on the day its member was freed after the merge', () => {
    // Why: ORCA-606 merged on the 17th (Bogota) and its member was freed with PR merged on the 18th.
    const doneOn = (day: string): string[] =>
      computeGameMetrics(stores, gameDayWindowOf(day, timezone)).ticketsDone
    expect(doneOn('2026-10-17')).toContain('ORCA-606')
    expect(doneOn('2026-10-18')).toContain('ORCA-606')
    const summary = gameMetricsSummaryOf(stores, { now, timezone })
    const on = (day: string): number | undefined =>
      summary.mergedPerDay.find((one) => one.day === day)?.merged
    expect(on('2026-10-17')).toBe(doneOn('2026-10-17').length)
    expect(on('2026-10-18')).toBe(doneOn('2026-10-18').length - 1)
  })

  it('takes lead time over the whole window, as the CLI does from its first day', () => {
    const summary = gameMetricsSummaryOf(stores, { now, timezone })
    const { since } = gameDayWindowOf('2026-10-17', timezone)
    const cli = computeGameMetrics(stores, { since }).leadTime
    expect(summary.leadTime).toEqual({ medianMs: cli.medianMs, measured: cli.tickets.length })
    expect(summary.leadTime.measured).toBeGreaterThan(0)
  })

  it('states when and in which zone it was computed', () => {
    const summary = gameMetricsSummaryOf(stores, { now, timezone })
    expect(summary.computedAt).toBe(recorded.recordedAt)
    expect(summary.timezone).toBe(timezone)
  })

  it('stays inside the payload and compute budgets on the recorded stores', () => {
    const started = performance.now()
    const summary = gameMetricsSummaryOf(stores, { now, timezone })
    const elapsed = performance.now() - started
    const claudeAccounts = Array.from({ length: GAME_CLAUDE_ACCOUNTS_MAX }, (_, index) => ({
      email: `a-rather-long-account-name-${index}@example-company.com`,
      active: index === 0,
      sessionPercent: 100,
      weeklyPercent: 100
    }))
    const carried = { ...summary, claudeAccounts }
    expect(JSON.stringify(carried).length).toBeLessThanOrEqual(GAME_METRICS_PAYLOAD_BUDGET_BYTES)
    expect(elapsed).toBeLessThan(GAME_METRICS_COMPUTE_BUDGET_MS)
  })
})
