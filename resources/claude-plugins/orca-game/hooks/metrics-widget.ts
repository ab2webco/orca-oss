import type { GameClaudeAccountUse, GameMetrics } from '../types'
import { isShape, str } from './game-state-shapes'
import { metricsWords } from './metrics-words'

// The host sends at most 14 days and 8 accounts; the caps only bound a damaged state.
const DAYS_MAX = 31
const ACCOUNTS_MAX = 8
const SPARKS = '▁▂▃▄▅▆▇█'
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const METER_CELLS = [2, 6] as const
const EMAIL_MIN = 12
const HOUR_MS = 3_600_000

export type MetricsTone = 'gold' | 'dim' | 'plain' | 'warning' | 'danger'
export type MetricsLine = { key: string; parts: { text: string; tone: MetricsTone }[] }

const percentOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null

const accountOf = (value: unknown): GameClaudeAccountUse[] => {
  const email = isShape(value) ? str(value.email) : undefined
  return isShape(value) && email !== undefined
    ? [
        {
          email,
          active: value.active === true,
          sessionPercent: percentOf(value.sessionPercent),
          weeklyPercent: percentOf(value.weeklyPercent)
        }
      ]
    : []
}

/** The lead's delivery numbers from `orca game state` (ORCA-774); absent from an older host or a member. */
export const gameMetricsOf = (value: unknown): { metrics?: GameMetrics } => {
  if (!isShape(value) || !Array.isArray(value.mergedPerDay)) {
    return {}
  }
  const mergedPerDay = value.mergedPerDay.slice(-DAYS_MAX).flatMap((one) => {
    const day = isShape(one) ? str(one.day) : undefined
    const merged = isShape(one) ? one.merged : undefined
    return day !== undefined &&
      typeof merged === 'number' &&
      Number.isInteger(merged) &&
      merged >= 0
      ? [{ day, merged }]
      : []
  })
  if (mergedPerDay.length === 0) {
    return {}
  }
  const { medianMs, measured } = isShape(value.leadTime) ? value.leadTime : {}
  return {
    metrics: {
      mergedPerDay,
      leadTime: {
        medianMs: typeof medianMs === 'number' && medianMs >= 0 ? medianMs : null,
        measured:
          typeof measured === 'number' && Number.isInteger(measured) && measured >= 0 ? measured : 0
      },
      claudeAccounts: Array.isArray(value.claudeAccounts)
        ? value.claudeAccounts.flatMap(accountOf).slice(0, ACCOUNTS_MAX)
        : []
    }
  }
}

/** One cell per value: a zero lowest, the largest full. */
export const sparklineOf = (values: readonly number[]): string => {
  const top = Math.max(0, ...values)
  const last = SPARKS.length - 1
  return values
    .map((one) => SPARKS[top === 0 || one <= 0 ? 0 : Math.max(1, Math.ceil((one / top) * last))])
    .join('')
}

/** `percent` of `cells` filled, by eighths of a cell. */
export const meterOf = (percent: number, cells: number): string => {
  const eighths = Math.round((Math.min(100, Math.max(0, percent)) / 100) * cells * 8)
  return `${'█'.repeat(Math.floor(eighths / 8))}${EIGHTHS[eighths % 8]}`.padEnd(cells, '░')
}

const durationOf = (ms: number): string => {
  const hours = Math.floor(ms / HOUR_MS)
  const minutes = Math.round((ms % HOUR_MS) / 60_000)
  return hours >= 24
    ? `${Math.floor(hours / 24)}d ${hours % 24}h`
    : hours > 0
      ? `${hours}h ${minutes}m`
      : `${minutes}m`
}

const toneOf = (percent: number | null): MetricsTone =>
  percent === null ? 'dim' : percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : 'plain'

// `5h ` + meter + ` 100%`, twice, two apart.
const usageWidthOf = (cells: number): number => 2 * (3 + cells + 5) + 2

const usageParts = (account: GameClaudeAccountUse, cells: number): MetricsLine['parts'] =>
  (
    [
      ['5h', account.sessionPercent],
      ['7d', account.weeklyPercent]
    ] as const
  ).flatMap(([window, percent], at) => [
    { text: `${at === 0 ? '' : '  '}${window} `, tone: 'dim' as const },
    { text: meterOf(percent ?? 0, cells), tone: 'gold' as const },
    {
      text: ` ${(percent === null ? '—' : `${Math.round(percent)}%`).padStart(4)}`,
      tone: toneOf(percent)
    }
  ])

/** The widget's rows for a pane `columns` wide: merges per day, lead time, then each account. */
export function metricsLinesOf(metrics: GameMetrics, columns: number): MetricsLine[] {
  const words = metricsWords()
  const days = metrics.mergedPerDay
  const total = days.reduce((sum, one) => sum + one.merged, 0)
  const first = days[0]?.day.slice(5) ?? ''
  const last = days.at(-1)?.day.slice(5) ?? ''
  const median = metrics.leadTime.medianMs
  const axis: MetricsLine[] =
    days.length > first.length + last.length
      ? [
          {
            key: 'axis',
            parts: [
              {
                text: `${first}${' '.repeat(days.length - first.length - last.length)}${last}`,
                tone: 'dim'
              }
            ]
          }
        ]
      : []
  const accounts = metrics.claudeAccounts
  // A phone's two-row account keeps its meters on one row: two spaces, then both windows.
  const cells = Math.min(
    METER_CELLS[1],
    Math.max(METER_CELLS[0], Math.floor((columns - 2 - usageWidthOf(0)) / 2))
  )
  const emailRoom = Math.min(
    Math.max(0, ...accounts.map((one) => one.email.length)),
    columns - 4 - usageWidthOf(cells)
  )
  const isWide = emailRoom >= EMAIL_MIN
  return [
    {
      key: 'merged',
      parts: [
        { text: sparklineOf(days.map((one) => one.merged)), tone: 'gold' },
        { text: ` ${words.merged(total, days.length)}`, tone: 'plain' }
      ]
    },
    ...axis,
    {
      key: 'lead-time',
      parts: [
        {
          text: words.leadTime(
            median === null ? null : durationOf(median),
            metrics.leadTime.measured
          ),
          tone: 'plain'
        }
      ]
    },
    ...accounts.flatMap((account, at): MetricsLine[] => {
      const mark = { text: `${account.active ? '●' : '○'} `, tone: 'gold' as const }
      if (isWide) {
        const email = account.email.slice(0, emailRoom).padEnd(emailRoom + 2)
        return [
          {
            key: `account-${at}`,
            parts: [mark, { text: email, tone: 'plain' }, ...usageParts(account, cells)]
          }
        ]
      }
      return [
        {
          key: `account-${at}-name`,
          parts: [mark, { text: account.email.slice(0, Math.max(1, columns - 2)), tone: 'plain' }]
        },
        {
          key: `account-${at}`,
          parts: [{ text: '  ', tone: 'dim' }, ...usageParts(account, cells)]
        }
      ]
    })
  ]
}
