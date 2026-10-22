import {
  GAME_EVENT_KINDS,
  GAME_EVENTS_MAX,
  type GameEvent,
  type GameEventKind
} from './orchestrator-game-events'
import {
  GAME_HISTORY_MAX,
  GAME_HISTORY_OUTCOMES,
  type GameHistoryOutcome,
  type GameHistoryRecord
} from './orchestrator-game-history'

/** A project's delivery numbers from its game events and history: `orca game metrics`. */

export type GameMetricsFilter = { since?: string; until?: string; ticket?: string }

export type GameLeadTime = {
  ticket: string
  claimedAt: string
  mergedAt: string
  /** `member_freed`: no merged event, so it ends when the member was freed, just after its merge. */
  endsAt: 'merged_event' | 'member_freed'
  ms: number
  /** Claims recorded for the ticket; more than 1 means it was relaunched. */
  claims: number
}

export type GameMetricNotRecorded = { metric: string; label: string; needs: string }

export type GameMetrics = {
  window: { since: string | null; until: string | null; ticket: string | null }
  /** Tickets with a merged event, or freed as merged or with a merged PR, in the window. */
  ticketsDone: string[]
  leadTime: {
    tickets: GameLeadTime[]
    /** Done tickets with no claim before their merge, or a claim outside the stores. */
    unmeasured: string[]
    medianMs: number | null
    meanMs: number | null
  }
  /** Members freed in the window, by outcome. */
  outcomes: Record<GameHistoryOutcome, number>
  events: Record<GameEventKind, number>
  notRecorded: readonly GameMetricNotRecorded[]
  /** The store is full and its oldest entry is inside the window, so the window's start is gone. */
  truncated: { events: boolean; history: boolean }
}

export const GAME_METRICS_NOT_RECORDED: readonly GameMetricNotRecorded[] = [
  {
    metric: 'firstTimeGreenRate',
    label: 'first-time-green rate',
    needs: 'CI outcomes per PR (ORCA-686)'
  },
  { metric: 'rework', label: 'rework', needs: 'reopen and revert facts (ORCA-686)' },
  { metric: 'averagePrSize', label: 'average PR size', needs: 'PR size per merge' },
  {
    metric: 'cleanupCompliance',
    label: 'cleanup after merge',
    needs: 'branch and worktree removal facts'
  },
  { metric: 'trackerDrift', label: 'tracker drift', needs: 'a tracker status fact' },
  { metric: 'xp', label: 'XP', needs: 'XP on the Orca host (ORCA-684)' },
  { metric: 'achievements', label: 'achievements', needs: 'an achievement record' }
]

// Why exact: history writes `#<number> <open|closed|merged|draft>`.
const MERGED_PR = /^#\d+ merged$/
// Why: launchedAt is SQLite's datetime('now'), UTC with no zone, which Date.parse reads as local.
const ZONELESS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

function parseUtc(value: string | null): number {
  if (!value) {
    return Number.NaN
  }
  return Date.parse(ZONELESS.test(value) ? `${value.replace(' ', 'T')}Z` : value)
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function countBy<K extends string>(keys: readonly K[], values: readonly K[]): Record<K, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>
  for (const value of values) {
    counts[value] += 1
  }
  return counts
}

function isTruncated(times: readonly number[], max: number, since: number): boolean {
  if (times.length < max) {
    return false
  }
  const oldest = Math.min(...times)
  return Number.isNaN(since) || oldest > since
}

const isDoneRecord = (one: GameHistoryRecord): boolean =>
  one.outcome === 'merged' || (one.pr !== null && MERGED_PR.test(one.pr))

/** `events` and `history` are the whole stores: a claim before the window still starts its lead time. */
export function computeGameMetrics(
  stores: { events: readonly GameEvent[]; history: readonly GameHistoryRecord[] },
  filter: GameMetricsFilter
): GameMetrics {
  const ticket = filter.ticket?.trim().toUpperCase() || null
  const since = filter.since ? Date.parse(filter.since) : Number.NaN
  const until = filter.until ? Date.parse(filter.until) : Number.NaN
  const inWindow = (at: number): boolean =>
    (Number.isNaN(since) || at >= since) && (Number.isNaN(until) || at < until)
  const ofTicket = (one: { ticket: string | null }): boolean => !ticket || one.ticket === ticket

  const events = stores.events.filter(ofTicket)
  const history = stores.history.filter(ofTicket)
  const windowEvents = events.filter((one) => inWindow(Date.parse(one.at)))
  const windowHistory = history.filter((one) => inWindow(Date.parse(one.endedAt)))

  const mergedAt = new Map<string, number>()
  for (const one of windowEvents) {
    const at = Date.parse(one.at)
    if (one.kind === 'merged' && one.ticket && at > (mergedAt.get(one.ticket) ?? -Infinity)) {
      mergedAt.set(one.ticket, at)
    }
  }
  const freedAt = new Map<string, number>()
  for (const one of windowHistory) {
    const at = Date.parse(one.endedAt)
    if (one.ticket && isDoneRecord(one) && at > (freedAt.get(one.ticket) ?? -Infinity)) {
      freedAt.set(one.ticket, at)
    }
  }
  const doneAt = new Map<string, { at: number; endsAt: GameLeadTime['endsAt'] }>()
  for (const [name, at] of freedAt) {
    doneAt.set(name, { at, endsAt: 'member_freed' })
  }
  for (const [name, at] of mergedAt) {
    doneAt.set(name, { at, endsAt: 'merged_event' })
  }
  const done = [...doneAt].toSorted(([a], [b]) => a.localeCompare(b))
  const ticketsDone = done.map(([name]) => name)

  const leadTimes: GameLeadTime[] = []
  const unmeasured: string[] = []
  for (const [name, { at: merged, endsAt }] of done) {
    const claims = events.filter((one) => one.kind === 'claimed' && one.ticket === name)
    const claimTimes = [
      ...claims.map((one) => Date.parse(one.at)),
      ...(claims.length > 0
        ? []
        : history.filter((one) => one.ticket === name).map((one) => parseUtc(one.launchedAt)))
    ].filter((at) => !Number.isNaN(at) && at <= merged)
    if (claimTimes.length === 0) {
      unmeasured.push(name)
      continue
    }
    const claimed = Math.min(...claimTimes)
    leadTimes.push({
      ticket: name,
      claimedAt: new Date(claimed).toISOString(),
      mergedAt: new Date(merged).toISOString(),
      endsAt,
      ms: merged - claimed,
      claims: claims.length
    })
  }
  const durations = leadTimes.map((one) => one.ms)

  return {
    window: { since: filter.since ?? null, until: filter.until ?? null, ticket },
    ticketsDone,
    leadTime: {
      tickets: leadTimes,
      unmeasured,
      medianMs: median(durations),
      meanMs:
        durations.length === 0
          ? null
          : durations.reduce((sum, ms) => sum + ms, 0) / durations.length
    },
    outcomes: countBy(
      GAME_HISTORY_OUTCOMES,
      windowHistory.map((one) => one.outcome)
    ),
    events: countBy(
      GAME_EVENT_KINDS,
      windowEvents.map((one) => one.kind)
    ),
    notRecorded: GAME_METRICS_NOT_RECORDED,
    truncated: {
      events: isTruncated(
        stores.events.map((one) => Date.parse(one.at)),
        GAME_EVENTS_MAX,
        since
      ),
      history: isTruncated(
        stores.history.map((one) => Date.parse(one.endedAt)),
        GAME_HISTORY_MAX,
        since
      )
    }
  }
}
