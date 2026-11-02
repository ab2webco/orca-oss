import type { GameMetrics } from '../types'
import { isShape, oneOf, str } from './game-state-shapes'
import { metricsWords } from './metrics-words'

type GameClaudeAccountUse = GameMetrics['claudeAccounts'][number]
type GameMetricsSource = NonNullable<GameMetrics['source']>

// The host sends at most 14 days and 8 accounts; the caps only bound a damaged state.
const DAYS_MAX = 31
const ACCOUNTS_MAX = 8
const BLOCKS = ' ▁▂▃▄▅▆▇█'
const BAR_ROWS = 3
// Widest first: a bar two cells wide with a gap, then without, then one cell.
const BAR_FITS = [
  [2, 1],
  [2, 0],
  [1, 1],
  [1, 0]
] as const
const AXIS_MIN_GAP = 1
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const METER_CELLS = [2, 12] as const
const EMAIL_MIN = 12
const WIDE_METER_MIN_CELLS = 6
const HOUR_MS = 3_600_000

export type MetricsTone = 'gold' | 'dim' | 'track' | 'plain' | 'warning' | 'danger'
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

const sourceOf = (value: unknown): { source?: GameMetricsSource } => {
  const one = isShape(value) ? value : {}
  const kind = oneOf(one.kind, ['github', 'gitlab', 'game'] as const)
  const fetchedAt = str(one.fetchedAt)
  const repo = str(one.repo)
  return kind && fetchedAt && !Number.isNaN(Date.parse(fetchedAt))
    ? {
        source: {
          kind,
          fetchedAt,
          ...(repo && { repo }),
          ...(one.partial === true && { partial: true })
        }
      }
    : {}
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
        : [],
      ...sourceOf(value.source)
    }
  }
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

// The filled part in gold and the empty track in the panel color, so the meters read apart row by row.
const meterPartsOf = (percent: number, cells: number): MetricsLine['parts'] => {
  const meter = meterOf(percent, cells)
  const filled = meter.replace(/░+$/, '')
  return [
    ...(filled === '' ? [] : [{ text: filled, tone: 'gold' as const }]),
    ...(filled === meter ? [] : [{ text: meter.slice(filled.length), tone: 'track' as const }])
  ]
}

/** Where the days come from and when they were read (local `HH:MM`); the repo only when it fits. */
export const metricsSourceOf = (
  { kind, repo, fetchedAt, partial }: GameMetricsSource,
  columns: number
): string => {
  const say = (shown?: string) =>
    metricsWords().source(kind, shown, new Date(fetchedAt).toTimeString().slice(0, 5), partial)
  const full = say(repo)
  return full.length <= columns ? full : say()
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
    ...meterPartsOf(percent ?? 0, cells),
    {
      text: ` ${(percent === null ? '—' : `${Math.round(percent)}%`).padStart(4)}`,
      tone: toneOf(percent)
    }
  ])

/** Days as bars `BAR_ROWS` tall in eighth blocks, top row first, the busiest day full and a zero a floor. */
export function mergedBarsOf(
  values: readonly number[],
  room: number
): { rows: string[]; width: number; cells: number; gap: number } {
  const widthOf = (count: number, cells: number, gap: number) => count * cells + (count - 1) * gap
  const fit = BAR_FITS.find(([cells, gap]) => widthOf(values.length, cells, gap) <= room)
  const [cells, gap] = fit ?? [1, 0]
  const shown = fit === undefined ? values.slice(-Math.max(1, room)) : values
  const top = Math.max(0, ...shown)
  const rows = Array.from({ length: BAR_ROWS }, (_row, at) => {
    const below = BAR_ROWS - 1 - at
    return shown
      .map((one) => {
        const eighths = top === 0 ? 0 : Math.round((one / top) * BAR_ROWS * 8)
        const inRow = Math.max(0, Math.min(8, eighths - below * 8))
        return (inRow === 0 && below === 0 ? '▁' : BLOCKS[inRow]!).repeat(cells)
      })
      .join(' '.repeat(gap))
  })
  return { rows, width: widthOf(shown.length, cells, gap), cells, gap }
}

/** The first and last day (`MM-DD`) under bars `width` cells wide; empty when the two do not fit. */
export function mergedAxisOf(days: GameMetrics['mergedPerDay'], width: number): string {
  const first = days[0]?.day.slice(5) ?? ''
  const last = days.at(-1)?.day.slice(5) ?? ''
  const gap = width - first.length - last.length
  return days.length < 2 || gap < AXIS_MIN_GAP ? '' : `${first}${' '.repeat(gap)}${last}`
}

export function mergedStatsOf(days: GameMetrics['mergedPerDay']): {
  total: number
  perDay: string
  peak: number
} {
  const total = days.reduce((sum, one) => sum + one.merged, 0)
  return {
    total,
    perDay: (days.length === 0 ? 0 : total / days.length).toFixed(1),
    peak: Math.max(0, ...days.map((one) => one.merged))
  }
}

/** Tickets from the game's own events, PRs once the host read the review provider. */
export const leadTimeOf = (
  metrics: GameMetrics
): { value: string | null; measured: number; unit: 'ticket' | 'PR' } => ({
  value: metrics.leadTime.medianMs === null ? null : durationOf(metrics.leadTime.medianMs),
  measured: metrics.leadTime.measured,
  unit: (metrics.source?.kind ?? 'game') === 'game' ? 'ticket' : 'PR'
})

/** Each account on one row when its email fits beside both meters, else its email above them. */
export function accountLinesOf(
  accounts: GameMetrics['claudeAccounts'],
  columns: number
): MetricsLine[] {
  const longest = Math.max(0, ...accounts.map((one) => one.email.length))
  const clamp = (cells: number) => Math.min(METER_CELLS[1], Math.max(METER_CELLS[0], cells))
  const wideCells = clamp(Math.floor((columns - 4 - longest - usageWidthOf(0)) / 2))
  const emailRoom = Math.min(longest, columns - 4 - usageWidthOf(wideCells))
  // One row only while the meters keep their width there; a phone gives the email a row instead.
  const isWide = emailRoom >= EMAIL_MIN && wideCells >= WIDE_METER_MIN_CELLS
  // A phone's two-row account keeps its meters on one row: two spaces, then both windows.
  const cells = isWide ? wideCells : clamp(Math.floor((columns - 2 - usageWidthOf(0)) / 2))
  return accounts.flatMap((account, at): MetricsLine[] => {
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
      { key: `account-${at}`, parts: [{ text: '  ', tone: 'dim' }, ...usageParts(account, cells)] }
    ]
  })
}
