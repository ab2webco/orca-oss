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

type StatuslineTrendGlyphs = {
  readonly rising: string
  readonly falling: string
  readonly steady: string
}

// Why 5 cells: measured against the 96-column budget with every field present. The widest
// realistic line — announce banner, model, a bounded 22-column account and three bars — lands at
// 95 columns; six cells per bar puts it at 98 and starts dropping the weekly quota.
export const STATUSLINE_BAR_CELLS = 5

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
 * One bar per level, from empty to full.
 *
 * Why floor and never round up: an overstated bar claims consumption that has not happened, and
 * reserving the all-full bar for a true 100% makes the exhausted state unmistakable.
 */
function barLevels(full: string, half: string, empty: string): readonly string[] {
  return Array.from({ length: STATUSLINE_BAR_LEVELS }, (_unused, level) => {
    const fullCells = Math.floor(level / 2)
    const halfCells = level % 2
    const emptyCells = STATUSLINE_BAR_CELLS - fullCells - halfCells
    return `${full.repeat(fullCells)}${half.repeat(halfCells)}${empty.repeat(emptyCells)}`
  })
}

export const STATUSLINE_BAR_LEVELS_UNICODE = barLevels('█', '▌', '░')
export const STATUSLINE_BAR_LEVELS_ASCII = barLevels('#', '=', '.')

/**
 * `orca_statusline_gauge <percent>` — sets `orca_statusline_gauge_out` to the bar, or to empty
 * when the value is not a percentage we parsed ourselves.
 *
 * Why the canonical-decimal allow-list and not a digits test: a leading-zero value is invalid
 * octal inside `$(( ))` and is FATAL in dash, which would kill the script before it printed —
 * the same class of bug that once wedged the post stamp.
 */
export function posixGaugeFunctionLines(): readonly string[] {
  return [
    'orca_statusline_gauge() {',
    '  orca_statusline_gauge_out=',
    '  case "$1" in 0|[1-9]|[1-9][0-9]*) ;; *) return 0 ;; esac',
    '  if [ "${#1}" -gt 3 ]; then return 0; fi',
    '  orca_statusline_gauge_level=$(( $1 / 10 ))',
    '  if [ "$orca_statusline_gauge_level" -gt 10 ]; then orca_statusline_gauge_level=10; fi',
    '  case "$orca_statusline_gauge_level" in',
    ...STATUSLINE_BAR_LEVELS_UNICODE.map(
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
 * The lookup string every cmd bar is sliced out of: all levels concatenated, 5 characters each.
 *
 * Why a slice and not a chain of `if`s: cmd has no `case`, and eleven comparisons per metric
 * would be thirty-three lines of branch for a table that reads better as a table.
 */
export function windowsGaugeTableLine(variable: string): string {
  return `set "${variable}=${STATUSLINE_BAR_LEVELS_ASCII.join('')}"`
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
  tableVar: string
): readonly string[] {
  const cells = STATUSLINE_BAR_CELLS
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
