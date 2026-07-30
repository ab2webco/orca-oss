/**
 * The status line's shared line model: bar level tables, trend/reset glyphs, field bounds,
 * the 96-column budget, and a TS composition of the rendered line.
 *
 * Why one shared module: the shell/cmd script generators (main) and the Settings preview
 * (renderer) must agree on every derivation — cell counts, glyphs, bounds, field order and
 * drop priority. The scripts still render at runtime in sh/cmd; `composeStatusLine` mirrors
 * that composition so the preview never re-guesses it, and parity tests in
 * `src/main/claude/statusline-preview-parity.test.ts` hold the two implementations together.
 */

import type { ClaudeStatusLineItemKey, ClaudeStatusLineItems } from './claude-statusline-items'

// Why 96 is now the ceiling and the fallback, not the assumption: a status line that wraps
// reads as a broken app. The scripts budget each tick against the COLUMNS env Claude Code
// injects per statusLine invocation (v2.1.153+; measured on 2.1.220 — it tracks the mobile
// viewport refit, so the same PTY budgets correctly from whichever device looks at it).
// Clamped here because the field bounds were tuned for 96, and assumed here when COLUMNS is
// absent or malformed — reading the width any other way needs a subprocess on a ~3x/sec path.
export const STATUSLINE_MAX_WIDTH = 96

// Why a shared resolver: both script generators and the parity suite must trust the exact same
// COLUMNS grammar. No leading zeros — cmd's numeric IF parses them as octal — and four digits
// at most, mirroring the guards the generated scripts apply before arithmetic ever runs.
export function resolveStatusLineWidthBudget(columns: string | undefined): number {
  if (columns === undefined || !/^[1-9][0-9]{0,3}$/.test(columns)) {
    return STATUSLINE_MAX_WIDTH
  }
  return Math.min(Number(columns), STATUSLINE_MAX_WIDTH)
}

// Why 24: worktree directory names are the project identity here and routinely run long, so the
// bound keeps a meaningful prefix while capping the one new field that could blow the line.
export const STATUSLINE_PROJECT_MAX_COLUMNS = 24

// Why 21: an unusually long address is the one field that could blow the whole line, and the
// ladder would then drop quota to pay for it. Windows elides with "..." (18+3) to keep the
// same bound through the OEM codepage; POSIX renders "…" (20+1).
export const STATUSLINE_ACCOUNT_MAX_COLUMNS = 21

type StatuslineTrendGlyphs = {
  readonly rising: string
  readonly falling: string
  readonly steady: string
}

// Why 5 is the floor: measured against the 96-column budget with every legacy field present.
// The widest realistic line — announce banner, model, a bounded account and three bars — lands
// at 95 columns; a sixth cell per bar puts it at 98 and starts dropping the weekly quota.
export const STATUSLINE_BAR_CELLS_MIN = 5
// Why 10 is the cap: past ten cells each extra cell resolves less than 5 points, which the
// percentage printed next to the bar already says better.
export const STATUSLINE_BAR_CELLS_MAX = 10

// Nominal column cost of each optional field at the 5-cell baseline, separator included —
// the same counted (never measured) widths the scripts budget with. Disabling a reclaimable
// field frees its columns; enabling an added field (absent from the legacy line) spends them.
const RECLAIMABLE_ITEM_COLUMNS: Partial<Record<ClaudeStatusLineItemKey, number>> = {
  account: 25, // "@" + 21-column bounded local part + " · "
  fiveHourQuota: 16, // "5h " + 5-cell bar + " 100%" + " · "
  sevenDayQuota: 16, // "7d " + 5-cell bar + " 100%" + " · "
  resetCountdown: 11 // mark + " 23h59m" + " · "
}
const ADDED_ITEM_COLUMNS: Partial<Record<ClaudeStatusLineItemKey, number>> = {
  project: 27, // 24-column bounded directory name + " · "
  cost: 11 // "$9999.99" + " · "
}

/**
 * How many cells each bar gets, derived from which items are enabled.
 *
 * Why derived and not another constant: every field competes for the same assumed 96 columns,
 * so the only honest way to grow a bar is to spend columns the user explicitly freed by
 * turning fields off. Freed columns are split evenly across the enabled bars.
 */
export function deriveStatusLineBarCells(items: ClaudeStatusLineItems): number {
  const bars = [items.context, items.fiveHourQuota, items.sevenDayQuota].filter(Boolean).length
  if (bars === 0) {
    return STATUSLINE_BAR_CELLS_MIN
  }
  let freed = 0
  for (const [key, columns] of Object.entries(RECLAIMABLE_ITEM_COLUMNS)) {
    if (!items[key as ClaudeStatusLineItemKey]) {
      freed += columns
    }
  }
  for (const [key, columns] of Object.entries(ADDED_ITEM_COLUMNS)) {
    if (items[key as ClaudeStatusLineItemKey]) {
      freed -= columns
    }
  }
  const extra = Math.floor(Math.max(0, freed) / bars)
  return Math.min(STATUSLINE_BAR_CELLS_MAX, STATUSLINE_BAR_CELLS_MIN + extra)
}

// Why 11 levels over 5 cells: a half-block doubles the resolution to one step per 10 points
// without spending a sixth column, so 42% and 48% are still distinguishable at a glance.
export const STATUSLINE_BAR_LEVELS = 11

// Why 2 points: the percentage is floored to an integer, so a value sitting on a boundary flips
// one point by itself and an arrow that followed it would strobe on an idle pane. Two points is
// the smallest move that cannot be quantisation noise.
export const STATUSLINE_TREND_THRESHOLD = 2

export const STATUSLINE_TREND_UNICODE: StatuslineTrendGlyphs = {
  rising: '↑',
  falling: '↓',
  steady: '→'
}

// Why `+ - ~` and not `^ v =`: `^` is cmd's escape character and survives quoting only by
// accident, `v` reads as a letter next to a percentage, and `=` already means half-cell here.
export const STATUSLINE_TREND_ASCII: StatuslineTrendGlyphs = {
  rising: '+',
  falling: '-',
  steady: '~'
}

// Why `>` on cmd and not the trend's spare glyphs: `+ - ~` already mean a direction on this line,
// and `↻` would arrive as mojibake through the OEM codepage — the same trade as `…` vs `...`.
export const STATUSLINE_RESET_MARK_UNICODE = '↻'
export const STATUSLINE_RESET_MARK_ASCII = '>'

/**
 * One bar per level, from empty to full, scaled to the requested cell count.
 *
 * Why floor and never round up: an overstated bar claims consumption that has not happened, and
 * reserving the all-full bar for a true 100% makes the exhausted state unmistakable. Scaling in
 * half-cell units keeps a 5-cell bar identical to the legacy table (level = half-cells) while a
 * wider bar spreads the same 11 levels over more columns.
 */
function barLevels(full: string, half: string, empty: string, cells: number): readonly string[] {
  return Array.from({ length: STATUSLINE_BAR_LEVELS }, (_unused, level) => {
    const scaledHalves = Math.floor((level * cells * 2) / (STATUSLINE_BAR_LEVELS - 1))
    const fullCells = Math.floor(scaledHalves / 2)
    const halfCells = scaledHalves % 2
    const emptyCells = cells - fullCells - halfCells
    return `${full.repeat(fullCells)}${half.repeat(halfCells)}${empty.repeat(emptyCells)}`
  })
}

export function statuslineBarLevelsUnicode(cells: number): readonly string[] {
  return barLevels('█', '▌', '░', cells)
}

export function statuslineBarLevelsAscii(cells: number): readonly string[] {
  return barLevels('#', '=', '.', cells)
}

export type ClaudeStatusLineVariant = 'posix' | 'windows'

export type ClaudeStatusLineTrend = 'rising' | 'falling' | 'steady'

/** Raw values compose derives the fields from — the same shapes the scripts parse at runtime. */
export type ClaudeStatusLineSampleFields = {
  projectDir: string
  model: string
  contextPercent: number
  contextTrend: ClaudeStatusLineTrend | null
  accountEmail: string
  fiveHourPercent: number
  sevenDayPercent: number
  totalCostUsd: number
  resetCountdown: string
}

// Why stable example data instead of the live quota: the preview exists to compare layouts, and
// values that drift between renders would read as the preview being broken. ASCII-only by
// design — the scripts count bytes where the preview counts characters, and ASCII keeps the
// two accountings identical (see the width note on `composeStatusLine`).
export const CLAUDE_STATUSLINE_PREVIEW_SAMPLE: ClaudeStatusLineSampleFields = {
  projectDir: '/home/alex/projects/orca-app',
  model: 'Fable',
  contextPercent: 42,
  contextTrend: 'rising',
  accountEmail: 'alex@acme.dev',
  fiveHourPercent: 63,
  sevenDayPercent: 31,
  totalCostUsd: 3.42,
  resetCountdown: '2h14m'
}

type StatusLineVocabulary = {
  separator: string
  ellipsis: string
  resetMark: string
  trend: StatuslineTrendGlyphs
  bars: readonly string[]
}

function vocabularyFor(variant: ClaudeStatusLineVariant, cells: number): StatusLineVocabulary {
  if (variant === 'windows') {
    return {
      separator: ' | ',
      ellipsis: '...',
      resetMark: STATUSLINE_RESET_MARK_ASCII,
      trend: STATUSLINE_TREND_ASCII,
      bars: statuslineBarLevelsAscii(cells)
    }
  }
  return {
    separator: ' · ',
    ellipsis: '…',
    resetMark: STATUSLINE_RESET_MARK_UNICODE,
    trend: STATUSLINE_TREND_UNICODE,
    bars: statuslineBarLevelsUnicode(cells)
  }
}

function elide(value: string, maxColumns: number, ellipsis: string): string {
  if (value.length <= maxColumns) {
    return value
  }
  return `${value.slice(0, maxColumns - ellipsis.length)}${ellipsis}`
}

function barFor(vocabulary: StatusLineVocabulary, percent: number): string {
  const level = Math.min(STATUSLINE_BAR_LEVELS - 1, Math.floor(percent / 10))
  return vocabulary.bars[level] ?? ''
}

// Why truncation and never rounding: mirrors the scripts — the value is informative, not
// billing-grade, and $0.5 / $0.50 must not alternate between ticks.
function formatCost(totalCostUsd: number): string {
  const [integer = '', decimals = ''] = String(totalCostUsd).split('.')
  if (!/^\d{1,4}$/.test(integer)) {
    return ''
  }
  let cents = decimals.replace(/[^0-9].*$/, '').slice(0, 2)
  while (cents.length > 0 && cents.length < 2) {
    cents = `${cents}0`
  }
  return `$${integer}${cents ? `.${cents}` : ''}`
}

type ComposedField = {
  key: ClaudeStatusLineItemKey
  rendered: string
  width: number
  // Why two classes: identity fields (project, model, context) always print — dropping them
  // buys almost no width while costing the things the line exists to say. Budgeted fields
  // fall in configured order when columns run out, later entries first.
  budgeted: boolean
}

function composeField(
  key: ClaudeStatusLineItemKey,
  fields: ClaudeStatusLineSampleFields,
  vocabulary: StatusLineVocabulary,
  cells: number
): ComposedField | null {
  switch (key) {
    case 'project': {
      const name = fields.projectDir.replace(/\/$/, '').split(/[\\/]/).pop() ?? ''
      const rendered = elide(name, STATUSLINE_PROJECT_MAX_COLUMNS, vocabulary.ellipsis)
      return rendered
        ? {
            key,
            rendered,
            width: Math.min(name.length, STATUSLINE_PROJECT_MAX_COLUMNS),
            budgeted: false
          }
        : null
    }
    case 'model':
      return fields.model
        ? { key, rendered: fields.model, width: fields.model.length, budgeted: false }
        : null
    case 'context': {
      const percent = String(fields.contextPercent)
      const bar = barFor(vocabulary, fields.contextPercent)
      const trendGlyph = fields.contextTrend ? vocabulary.trend[fields.contextTrend] : ''
      const rendered = `ctx ${bar ? `${bar} ` : ''}${percent}%${trendGlyph ? ` ${trendGlyph}` : ''}`
      const width = percent.length + 5 + (bar ? cells + 1 : 0) + (trendGlyph ? 2 : 0)
      return { key, rendered, width, budgeted: false }
    }
    case 'account': {
      const local = fields.accountEmail.split('@')[0] ?? ''
      if (!local) {
        return null
      }
      const bounded = elide(local, STATUSLINE_ACCOUNT_MAX_COLUMNS, vocabulary.ellipsis)
      return {
        key,
        rendered: `@${bounded}`,
        width: Math.min(local.length, STATUSLINE_ACCOUNT_MAX_COLUMNS) + 1,
        budgeted: true
      }
    }
    case 'fiveHourQuota':
    case 'sevenDayQuota': {
      const percent = String(
        key === 'fiveHourQuota' ? fields.fiveHourPercent : fields.sevenDayPercent
      )
      const label = key === 'fiveHourQuota' ? '5h' : '7d'
      const bar = barFor(
        vocabulary,
        key === 'fiveHourQuota' ? fields.fiveHourPercent : fields.sevenDayPercent
      )
      return {
        key,
        rendered: `${label} ${bar ? `${bar} ` : ''}${percent}%`,
        width: percent.length + (bar ? cells : 0) + 5,
        budgeted: true
      }
    }
    case 'cost': {
      const rendered = formatCost(fields.totalCostUsd)
      return rendered ? { key, rendered, width: rendered.length, budgeted: true } : null
    }
    case 'resetCountdown':
      return fields.resetCountdown
        ? {
            key,
            rendered: `${vocabulary.resetMark} ${fields.resetCountdown}`,
            width: fields.resetCountdown.length + 2,
            budgeted: true
          }
        : null
  }
}

/**
 * The steady-state line the managed script prints for these items, in this order, on this
 * platform — the once-per-pane intro banner excluded on purpose.
 *
 * Width fidelity note: the scripts count bytes for plain-text spans while this counts
 * characters; the two agree exactly for ASCII field values, which the preview sample
 * guarantees. Budget semantics mirror the scripts: identity fields always append, budgeted
 * fields fall stickily — once one misses the width budget (the resolved terminal width,
 * assumed 96 when unknown), no later budgeted field is admitted behind it.
 */
export function composeStatusLine(
  items: ClaudeStatusLineItems,
  order: readonly ClaudeStatusLineItemKey[],
  variant: ClaudeStatusLineVariant,
  fields: ClaudeStatusLineSampleFields = CLAUDE_STATUSLINE_PREVIEW_SAMPLE,
  maxWidth: number = STATUSLINE_MAX_WIDTH
): string {
  const cells = deriveStatusLineBarCells(items)
  const vocabulary = vocabularyFor(variant, cells)
  let line = ''
  let width = 0
  let full = false
  for (const key of order) {
    if (!items[key]) {
      continue
    }
    const field = composeField(key, fields, vocabulary, cells)
    if (!field) {
      continue
    }
    const separatorWidth = line ? vocabulary.separator.length : 0
    if (field.budgeted) {
      if (full) {
        continue
      }
      if (width + separatorWidth + field.width > maxWidth) {
        full = true
        continue
      }
    }
    line = line ? `${line}${vocabulary.separator}${field.rendered}` : field.rendered
    width += separatorWidth + field.width
  }
  return line
}
