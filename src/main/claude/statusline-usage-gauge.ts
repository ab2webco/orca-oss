/**
 * The statusline's usage vocabulary: the progress-bar level table and the context trend glyphs,
 * plus the shell fragments that render them on each platform.
 *
 * Why one module for both platforms: POSIX emits a shell `case` and cmd emits a sliced lookup
 * string, but the two must agree on cell count and on what each level looks like — deriving both
 * from one table is what stops a pane from reading differently depending on the OS it runs on.
 *
 * Why the glyphs themselves diverge: `writeManagedScript` emits UTF-8 while cmd reads a .bat in
 * the console's OEM codepage, so a block element would arrive as mojibake on Windows — the same
 * constraint that already renders POSIX's `…` elision as `...` there. Degrading macOS and Linux
 * to ASCII to match would cost the platforms where the bar can look right, for a platform where
 * it cannot look right either way.
 */

import type {
  ClaudeStatusLineItemKey,
  ClaudeStatusLineItems
} from '../../shared/claude-statusline-items'

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
const STATUSLINE_BAR_LEVELS = 11

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

/**
 * The reset-countdown file contract, shared with the writer in `statusline-reset-countdown.ts`.
 *
 * Why the two sides must agree byte for byte: a path or charset mismatch renders as "the field
 * never appears", which is the failure mode nobody reports.
 */
export const STATUSLINE_RESET_FILE_PREFIX = 'orca-claude-statusline-reset-'
// Why a literal rather than no file at all: a session with no CLAUDE_CONFIG_DIR runs on the
// system-default account, which has a reset too. Account vault directories are UUIDs, so this
// name cannot collide with one.
export const STATUSLINE_RESET_DEFAULT_KEY = 'system-default'
export const STATUSLINE_RESET_KEY_MAX_CHARS = 64
// Longest value the writer can emit is "23h59m"; anything longer is a stale or foreign file.
export const STATUSLINE_RESET_MAX_CHARS = 6

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

/**
 * `orca_statusline_gauge <percent>` — sets `orca_statusline_gauge_out` to the bar, or to empty
 * when the value is not a percentage we parsed ourselves.
 *
 * Why the canonical-decimal allow-list and not a digits test: a leading-zero value is invalid
 * octal inside `$(( ))` and is FATAL in dash, which would kill the script before it printed —
 * the same class of bug that once wedged the post stamp.
 */
export function posixGaugeFunctionLines(cells: number): readonly string[] {
  return [
    'orca_statusline_gauge() {',
    '  orca_statusline_gauge_out=',
    '  case "$1" in 0|[1-9]|[1-9][0-9]*) ;; *) return 0 ;; esac',
    '  if [ "${#1}" -gt 3 ]; then return 0; fi',
    '  orca_statusline_gauge_level=$(( $1 / 10 ))',
    '  if [ "$orca_statusline_gauge_level" -gt 10 ]; then orca_statusline_gauge_level=10; fi',
    '  case "$orca_statusline_gauge_level" in',
    ...statuslineBarLevelsUnicode(cells).map(
      (bar, level) => `    ${level}) orca_statusline_gauge_out='${bar}' ;;`
    ),
    '  esac',
    '}'
  ]
}

/**
 * Direction of travel for the context percentage, from a per-pane baseline file.
 *
 * Why compare against the last *significant* level instead of the previous tick: rewriting the
 * baseline on every tick would let a slow climb of one point per turn read as steady forever,
 * because each step alone stays under the threshold. Holding the baseline until the threshold is
 * crossed makes the drift accumulate — and, as a side effect, most ticks write nothing at all.
 */
export function posixContextTrendLines(): readonly string[] {
  const trendFile = '"${TMPDIR:-/tmp}/orca-claude-statusline-ctx-${orca_statusline_intro_key}"'
  return [
    'orca_statusline_trend=',
    'if [ -n "$orca_statusline_intro_key" ] && [ -n "$orca_statusline_context" ]; then',
    `  orca_statusline_trend_file=${trendFile}`,
    '  orca_statusline_prev=',
    '  if [ -r "$orca_statusline_trend_file" ]; then',
    '    IFS= read -r orca_statusline_prev <"$orca_statusline_trend_file" 2>/dev/null || :',
    '  fi',
    '  case "$orca_statusline_prev" in 0|[1-9]|[1-9][0-9]*) ;; *) orca_statusline_prev= ;; esac',
    '  if [ "${#orca_statusline_prev}" -gt 3 ]; then orca_statusline_prev=; fi',
    // Why no arrow on the first sample: a direction invented from a missing baseline is a lie,
    // and this is exactly the tick where the user has the least reason to doubt the line.
    '  if [ -z "$orca_statusline_prev" ]; then',
    '    printf \'%s\' "$orca_statusline_context" >"$orca_statusline_trend_file" 2>/dev/null || :',
    '  else',
    '    orca_statusline_delta=$(( orca_statusline_context - orca_statusline_prev ))',
    `    if [ "$orca_statusline_delta" -ge ${STATUSLINE_TREND_THRESHOLD} ]; then`,
    `      orca_statusline_trend='${STATUSLINE_TREND_UNICODE.rising}'`,
    `    elif [ "$orca_statusline_delta" -le -${STATUSLINE_TREND_THRESHOLD} ]; then`,
    `      orca_statusline_trend='${STATUSLINE_TREND_UNICODE.falling}'`,
    '    else',
    `      orca_statusline_trend='${STATUSLINE_TREND_UNICODE.steady}'`,
    '    fi',
    `    if [ "$orca_statusline_trend" != '${STATUSLINE_TREND_UNICODE.steady}' ]; then`,
    '      printf \'%s\' "$orca_statusline_context" >"$orca_statusline_trend_file" 2>/dev/null || :',
    '    fi',
    '  fi',
    'fi'
  ]
}

/**
 * The quota reset countdown, read from the per-account file Orca refreshes on every live post.
 *
 * Why the script never computes it: turning `resets_at` into "2h14m" needs the wall clock, and a
 * POSIX shell only reaches one through `date` — a subprocess on a path that runs ~3x/sec. Why not
 * an injected env var either: it would freeze at spawn, so an hours-long session would count down
 * from the wrong instant, and a countdown that lies by hours is worse than no countdown.
 *
 * Why the pane-key gate: outside Orca nothing refreshes this file, so its content could be days
 * old. The percentages on the same line come from the payload and stay true either way.
 */
export function posixResetCountdownLines(): readonly string[] {
  const resetFile = `"\${TMPDIR:-/tmp}/${STATUSLINE_RESET_FILE_PREFIX}\${orca_statusline_reset_key}"`
  return [
    'orca_statusline_reset=',
    'if [ -n "$ORCA_PANE_KEY" ]; then',
    '  orca_statusline_reset_key=$orca_statusline_acct_key',
    `  if [ -z "$orca_statusline_reset_key" ] || [ "\${#orca_statusline_reset_key}" -gt ${STATUSLINE_RESET_KEY_MAX_CHARS} ]; then`,
    `    orca_statusline_reset_key=${STATUSLINE_RESET_DEFAULT_KEY}`,
    '  fi',
    `  orca_statusline_reset_file=${resetFile}`,
    '  if [ -r "$orca_statusline_reset_file" ]; then',
    '    IFS= read -r orca_statusline_reset <"$orca_statusline_reset_file" 2>/dev/null || :',
    '  fi',
    // Why an allow-list and not a trim: whatever else is in that file is stale or foreign, and
    // the one place it would surface is the user's status line.
    '  case "$orca_statusline_reset" in \'\'|*[!0-9dhm]*) orca_statusline_reset= ;; esac',
    `  if [ "\${#orca_statusline_reset}" -gt ${STATUSLINE_RESET_MAX_CHARS} ]; then orca_statusline_reset=; fi`,
    'fi'
  ]
}

/**
 * cmd's reset countdown, mirroring the POSIX rule.
 *
 * Why no separate length bound on the key: the account block already clears a key past 64
 * characters, so an overlong one lands on the same default file POSIX picks.
 */
export function windowsResetCountdownLines(doneLabel: string): readonly string[] {
  return [
    'set "ORCA_STATUSLINE_RESET="',
    `if not defined ORCA_PANE_KEY goto :${doneLabel}`,
    'set "ORCA_STATUSLINE_RESET_KEY=!ORCA_STATUSLINE_ACCT_KEY!"',
    `if not defined ORCA_STATUSLINE_RESET_KEY set "ORCA_STATUSLINE_RESET_KEY=${STATUSLINE_RESET_DEFAULT_KEY}"`,
    `set "ORCA_STATUSLINE_RESET_FILE=%TEMP%\\${STATUSLINE_RESET_FILE_PREFIX}!ORCA_STATUSLINE_RESET_KEY!.tmp"`,
    'if exist "!ORCA_STATUSLINE_RESET_FILE!" set /p ORCA_STATUSLINE_RESET=<"!ORCA_STATUSLINE_RESET_FILE!"',
    'if defined ORCA_STATUSLINE_RESET for /f "delims=0123456789dhm" %%r in ("!ORCA_STATUSLINE_RESET!") do set "ORCA_STATUSLINE_RESET="',
    `if defined ORCA_STATUSLINE_RESET if not "!ORCA_STATUSLINE_RESET:~${STATUSLINE_RESET_MAX_CHARS}!"=="" set "ORCA_STATUSLINE_RESET="`,
    `:${doneLabel}`
  ]
}

/**
 * The lookup string every cmd bar is sliced out of: all levels concatenated, `cells` characters
 * each.
 *
 * Why a slice and not a chain of `if`s: cmd has no `case`, and eleven comparisons per metric
 * would be thirty-three lines of branch for a table that reads better as a table.
 */
export function windowsGaugeTableLine(variable: string, cells: number): string {
  return `set "${variable}=${statuslineBarLevelsAscii(cells).join('')}"`
}

/**
 * One cmd bar, from a percentage variable into a target variable.
 *
 * Why the `for` indirection: a `%VAR%` offset inside `!TABLE:~offset,5!` is expanded at parse
 * time and would still hold the previous tick's value, while a for-variable is substituted after
 * parsing and before delayed expansion. Why `2>nul` on the arithmetic: an unparseable value must
 * leave the target undefined so the field renders nothing, never a false empty bar.
 */
export function windowsGaugeLines(
  valueVar: string,
  targetVar: string,
  tableVar: string,
  cells: number
): readonly string[] {
  return [
    `set "${targetVar}="`,
    'set "ORCA_STATUSLINE_LEVEL="',
    `if defined ${valueVar} set /a "ORCA_STATUSLINE_LEVEL=${valueVar}/10" 2>nul`,
    `if defined ORCA_STATUSLINE_LEVEL if !ORCA_STATUSLINE_LEVEL! GTR ${STATUSLINE_BAR_LEVELS - 1} set "ORCA_STATUSLINE_LEVEL=${STATUSLINE_BAR_LEVELS - 1}"`,
    `if defined ORCA_STATUSLINE_LEVEL set /a "ORCA_STATUSLINE_OFFSET=ORCA_STATUSLINE_LEVEL*${cells}" 2>nul`,
    `if defined ORCA_STATUSLINE_LEVEL for %%o in (!ORCA_STATUSLINE_OFFSET!) do set "${targetVar}=!${tableVar}:~%%o,${cells}!"`
  ]
}

/**
 * cmd's context trend, mirroring the POSIX baseline rule.
 *
 * Why the value is compared before it is subtracted: cmd's `IF` falls back to a *string* compare
 * the moment either side is not all digits, so a negative delta would silently mis-order. Taking
 * the larger side first keeps every comparison on non-negative digits.
 */
export function windowsContextTrendLines(doneLabel: string, writeLabel: string): readonly string[] {
  const riseLabel = 'orca_statusline_trend_rise'
  const fallLabel = 'orca_statusline_trend_fall'
  return [
    'set "ORCA_STATUSLINE_TREND="',
    `if not defined ORCA_STATUSLINE_CTX goto :${doneLabel}`,
    `if not defined ORCA_STATUSLINE_INTRO_KEY goto :${doneLabel}`,
    'set "ORCA_STATUSLINE_TREND_FILE=%TEMP%\\orca-claude-statusline-ctx-!ORCA_STATUSLINE_INTRO_KEY!.tmp"',
    'set "ORCA_STATUSLINE_PREV="',
    'if exist "!ORCA_STATUSLINE_TREND_FILE!" set /p ORCA_STATUSLINE_PREV=<"!ORCA_STATUSLINE_TREND_FILE!"',
    'if defined ORCA_STATUSLINE_PREV for /f "delims=0123456789" %%d in ("!ORCA_STATUSLINE_PREV!") do set "ORCA_STATUSLINE_PREV="',
    'if defined ORCA_STATUSLINE_PREV if not "!ORCA_STATUSLINE_PREV:~3!"=="" set "ORCA_STATUSLINE_PREV="',
    // Why the write with no arrow: the first sample records a baseline and claims no direction.
    `if not defined ORCA_STATUSLINE_PREV goto :${writeLabel}`,
    `set "ORCA_STATUSLINE_TREND=${STATUSLINE_TREND_ASCII.steady}"`,
    `if !ORCA_STATUSLINE_CTX! GTR !ORCA_STATUSLINE_PREV! goto :${riseLabel}`,
    `if !ORCA_STATUSLINE_PREV! GTR !ORCA_STATUSLINE_CTX! goto :${fallLabel}`,
    `goto :${doneLabel}`,
    `:${riseLabel}`,
    'set /a "ORCA_STATUSLINE_DELTA=ORCA_STATUSLINE_CTX-ORCA_STATUSLINE_PREV" 2>nul',
    `if !ORCA_STATUSLINE_DELTA! LSS ${STATUSLINE_TREND_THRESHOLD} goto :${doneLabel}`,
    `set "ORCA_STATUSLINE_TREND=${STATUSLINE_TREND_ASCII.rising}"`,
    `goto :${writeLabel}`,
    `:${fallLabel}`,
    'set /a "ORCA_STATUSLINE_DELTA=ORCA_STATUSLINE_PREV-ORCA_STATUSLINE_CTX" 2>nul',
    `if !ORCA_STATUSLINE_DELTA! LSS ${STATUSLINE_TREND_THRESHOLD} goto :${doneLabel}`,
    `set "ORCA_STATUSLINE_TREND=${STATUSLINE_TREND_ASCII.falling}"`,
    `:${writeLabel}`,
    '>"!ORCA_STATUSLINE_TREND_FILE!" echo !ORCA_STATUSLINE_CTX!',
    `:${doneLabel}`
  ]
}
