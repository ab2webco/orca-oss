import type { GameEvent } from './orchestrator-game-events'
import type { GameHistoryRecord } from './orchestrator-game-history'
import { computeGameMetrics } from './orchestrator-game-metrics'
import type { GameClaudeAccountUsage } from './orchestrator-game-claude-usage'

/** The scene's metrics widget data: `orca game state`'s optional `metrics` (ORCA-774). */

export const GAME_METRICS_DAYS = 14
export const GAME_METRICS_REFRESH_MS = 60_000
export const GAME_METRICS_PAYLOAD_BUDGET_BYTES = 2048
export const GAME_METRICS_COMPUTE_BUDGET_MS = 50

export type GameMetricsDay = { day: string; merged: number }

export type GameMetricsSummary = {
  computedAt: string
  /** The zone `day` is a calendar day of. */
  timezone: string
  /** Oldest first; `day` is `YYYY-MM-DD`. */
  mergedPerDay: GameMetricsDay[]
  /** Over the whole `mergedPerDay` window. */
  leadTime: { medianMs: number | null; measured: number }
  /** The managed Claude accounts' use; absent when the host has no account services. */
  claudeAccounts?: GameClaudeAccountUsage[]
}

const DAY_MS = 24 * 60 * 60 * 1000

const formats = new Map<string, Intl.DateTimeFormat>()

function wallClockOf(at: number, timezone: string): Record<string, number> {
  let format = formats.get(timezone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    formats.set(timezone, format)
  }
  const parts = format.formatToParts(at)
  return Object.fromEntries(
    parts.filter((one) => one.type !== 'literal').map((one) => [one.type, Number(one.value)])
  )
}

const offsetOf = (at: number, timezone: string): number => {
  const wall = wallClockOf(at, timezone)
  return (
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) -
    Math.floor(at / 1000) * 1000
  )
}

const dayKeyOf = (utcDate: number): string => new Date(utcDate).toISOString().slice(0, 10)

function midnightOf(day: string, timezone: string): number {
  const guess = Date.parse(`${day}T00:00:00.000Z`)
  // Why twice: the first offset is the one at UTC midnight, which can sit across a DST change.
  return guess - offsetOf(guess - offsetOf(guess, timezone), timezone)
}

/** One calendar day in `timezone` as the half-open window `computeGameMetrics` filters by. */
export function gameDayWindowOf(day: string, timezone: string): { since: string; until: string } {
  const next = dayKeyOf(Date.parse(`${day}T00:00:00.000Z`) + DAY_MS)
  return {
    since: new Date(midnightOf(day, timezone)).toISOString(),
    until: new Date(midnightOf(next, timezone)).toISOString()
  }
}

/** The last `days` calendar days in `timezone`, today included; `stores` are the whole stores. */
export function gameMetricsSummaryOf(
  stores: { events: readonly GameEvent[]; history: readonly GameHistoryRecord[] },
  options: { now: number; timezone: string; days?: number }
): GameMetricsSummary {
  const { now, timezone } = options
  const days = options.days ?? GAME_METRICS_DAYS
  const today = wallClockOf(now, timezone)
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day)
  const mergedPerDay = Array.from({ length: days }, (_, index) => {
    const day = dayKeyOf(todayUtc - (days - 1 - index) * DAY_MS)
    return {
      day,
      merged: computeGameMetrics(stores, gameDayWindowOf(day, timezone)).ticketsDone.length
    }
  })
  const { leadTime } = computeGameMetrics(stores, {
    since: gameDayWindowOf(mergedPerDay[0].day, timezone).since
  })
  return {
    computedAt: new Date(now).toISOString(),
    timezone,
    mergedPerDay,
    leadTime: { medianMs: leadTime.medianMs, measured: leadTime.tickets.length }
  }
}
