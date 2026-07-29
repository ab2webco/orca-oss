/**
 * cmd.exe fragments that parse one statusline-payload field each, consumed by
 * `getWindowsManagedStatusLineScript`. Builtin-only by contract: these run ~3x/sec.
 */

// Why 96: the POSIX branch's budget, kept identical so a pane renders the same width on either OS.
// Why a raw substring test still measures it correctly here: this variant is ASCII by contract,
// so one byte is one column — the POSIX branch has to count columns because its bars are not.
export const STATUSLINE_WINDOWS_MAX_WIDTH = 96
// Why 24: the same bound the POSIX branch puts on the one new field that could blow the line.
const STATUSLINE_PROJECT_MAX_COLUMNS = 24

export const STATUSLINE_WINDOWS_EMIT_LABEL = 'orca_statusline_emit'

/**
 * One `rate_limits` window, bounded at its own first `}`.
 *
 * Why bound before searching: five_hour and seven_day both carry used_percentage, so a window
 * that omits its own would otherwise borrow its sibling's — and any key reorder swaps the two.
 * Quotes become commas first because `for /f` cannot take a quote-bearing string, and the `x`
 * prefix keeps token 1 non-empty so a leading `}` can never shift the split.
 */
export function quotaWindowLines(
  windowKey: string,
  targetVar: string,
  doneLabel: string
): string[] {
  return [
    `set "ORCA_STATUSLINE_WINDOW=!ORCA_STATUSLINE_LIMITS:*"${windowKey}"=!"`,
    `if "!ORCA_STATUSLINE_WINDOW!"=="!ORCA_STATUSLINE_LIMITS!" goto :${doneLabel}`,
    'set "ORCA_STATUSLINE_WINDOW=!ORCA_STATUSLINE_WINDOW:"=,!"',
    'set "ORCA_STATUSLINE_SCOPE="',
    'for /f "delims=}" %%w in ("x!ORCA_STATUSLINE_WINDOW!") do set "ORCA_STATUSLINE_SCOPE=%%w"',
    'set "ORCA_STATUSLINE_PCT=!ORCA_STATUSLINE_SCOPE:*,used_percentage,=!"',
    `if "!ORCA_STATUSLINE_PCT!"=="!ORCA_STATUSLINE_SCOPE!" goto :${doneLabel}`,
    'set "ORCA_STATUSLINE_PCT=!ORCA_STATUSLINE_PCT:*:=!"',
    'set "ORCA_STATUSLINE_PCT=!ORCA_STATUSLINE_PCT:~0,16!"',
    'set "ORCA_STATUSLINE_PCT=!ORCA_STATUSLINE_PCT: =!"',
    'set "ORCA_STATUSLINE_VALUE="',
    'for /f "delims=.," %%p in ("!ORCA_STATUSLINE_PCT!") do if not defined ORCA_STATUSLINE_VALUE set "ORCA_STATUSLINE_VALUE=%%p"',
    // Why digits-only plus a 3-char cap: a missing value must render nothing, never a false 0%.
    'for /f "delims=0123456789" %%d in ("!ORCA_STATUSLINE_VALUE!") do set "ORCA_STATUSLINE_VALUE="',
    'if defined ORCA_STATUSLINE_VALUE if not "!ORCA_STATUSLINE_VALUE:~3!"=="" set "ORCA_STATUSLINE_VALUE="',
    `set "${targetVar}=!ORCA_STATUSLINE_VALUE!"`
  ]
}

/**
 * One optional trailing field, admitted only if the whole line still fits the budget.
 *
 * Why goto-emit instead of skipping to the next field: admitting a shorter field behind one that
 * did not fit inverts the priority order the ladder exists to express.
 */
export function budgetedFieldLines(
  valueVar: string,
  rendered: string,
  nextLabel: string
): string[] {
  return [
    `if not defined ${valueVar} goto :${nextLabel}`,
    `set "ORCA_STATUSLINE_NEXT=${rendered}"`,
    `if defined ORCA_STATUSLINE_LINE set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_LINE! | ${rendered}"`,
    `if not "!ORCA_STATUSLINE_NEXT:~${STATUSLINE_WINDOWS_MAX_WIDTH}!"=="" goto :${STATUSLINE_WINDOWS_EMIT_LABEL}`,
    'set "ORCA_STATUSLINE_LINE=!ORCA_STATUSLINE_NEXT!"'
  ]
}

export function windowsModelLines(): string[] {
  return [
    // Why: strip through the value's opening quote, turn remaining quotes into delimiters,
    // and take token 1 — pure-builtin field extraction with no subprocess per tick.
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_JSON:*"display_name"=!"',
    'if "!ORCA_STATUSLINE_REST!"=="!ORCA_STATUSLINE_JSON!" goto :orca_statusline_model_id',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_REST:*"=!"',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_REST:"=,!"',
    'if "!ORCA_STATUSLINE_REST:~0,1!"=="," goto :orca_statusline_model_id',
    'for /f "delims=," %%m in ("!ORCA_STATUSLINE_REST!") do if not defined ORCA_STATUSLINE_MODEL set "ORCA_STATUSLINE_MODEL=%%m"',
    ':orca_statusline_model_id',
    // Why: mirror parseModelLabel's display_name → model.id fallback so older CLIs still label the line.
    'if defined ORCA_STATUSLINE_MODEL goto :orca_statusline_model_done',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_JSON:*"model"=!"',
    'if "!ORCA_STATUSLINE_REST!"=="!ORCA_STATUSLINE_JSON!" goto :orca_statusline_model_done',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_REST:*"id"=!"',
    'if "!ORCA_STATUSLINE_NEXT!"=="!ORCA_STATUSLINE_REST!" goto :orca_statusline_model_done',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:*"=!"',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:"=,!"',
    'if "!ORCA_STATUSLINE_NEXT:~0,1!"=="," goto :orca_statusline_model_done',
    'for /f "delims=," %%m in ("!ORCA_STATUSLINE_NEXT!") do if not defined ORCA_STATUSLINE_MODEL set "ORCA_STATUSLINE_MODEL=%%m"',
    ':orca_statusline_model_done'
  ]
}

export function windowsContextLines(): string[] {
  return [
    // Why: scope the search to context_window so rate_limits' used_percentage (a different
    // metric) can never masquerade as context usage; cap at 16 chars before tokenizing.
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_JSON:*"context_window"=!"',
    'if "!ORCA_STATUSLINE_REST!"=="!ORCA_STATUSLINE_JSON!" goto :orca_statusline_ctx_done',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_REST:*"used_percentage"=!"',
    'if "!ORCA_STATUSLINE_NEXT!"=="!ORCA_STATUSLINE_REST!" goto :orca_statusline_ctx_done',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:*:=!"',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:~0,16!"',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:"=,!"',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT: =!"',
    'for /f "delims=.,}" %%p in ("!ORCA_STATUSLINE_NEXT!") do if not defined ORCA_STATUSLINE_CTX set "ORCA_STATUSLINE_CTX=%%p"',
    'for /f "delims=0123456789" %%d in ("!ORCA_STATUSLINE_CTX!") do set "ORCA_STATUSLINE_CTX="',
    'if defined ORCA_STATUSLINE_CTX if not "!ORCA_STATUSLINE_CTX:~3!"=="" set "ORCA_STATUSLINE_CTX="',
    ':orca_statusline_ctx_done'
  ]
}

// Why the directory name and not the full path: the basename is the project identity the owner
// asked to see, and a full path would eat the entire budget the quota bars need.
export function windowsProjectLines(): string[] {
  return [
    'set "ORCA_STATUSLINE_PROJECT="',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_JSON:*"project_dir"=!"',
    'if "!ORCA_STATUSLINE_REST!"=="!ORCA_STATUSLINE_JSON!" goto :orca_statusline_project_done',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_REST:*"=!"',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_REST:"=,!"',
    'if "!ORCA_STATUSLINE_REST:~0,1!"=="," goto :orca_statusline_project_done',
    'for /f "delims=," %%p in ("!ORCA_STATUSLINE_REST!") do if not defined ORCA_STATUSLINE_PROJECT set "ORCA_STATUSLINE_PROJECT=%%p"',
    // Why the unescape: JSON doubles every backslash in a Windows path, and %%~nx needs real ones.
    'if defined ORCA_STATUSLINE_PROJECT set "ORCA_STATUSLINE_PROJECT=!ORCA_STATUSLINE_PROJECT:\\\\=\\!"',
    'if defined ORCA_STATUSLINE_PROJECT for %%d in ("!ORCA_STATUSLINE_PROJECT!") do set "ORCA_STATUSLINE_PROJECT=%%~nxd"',
    // ASCII "..." where POSIX renders "…", for the same OEM-codepage reason the elision does.
    `if defined ORCA_STATUSLINE_PROJECT if not "!ORCA_STATUSLINE_PROJECT:~${STATUSLINE_PROJECT_MAX_COLUMNS}!"=="" set "ORCA_STATUSLINE_PROJECT=!ORCA_STATUSLINE_PROJECT:~0,${STATUSLINE_PROJECT_MAX_COLUMNS - 3}!..."`,
    ':orca_statusline_project_done'
  ]
}

// Why truncation and never arithmetic: cmd's set /a is integer-only and the value is
// informative, not billing-grade — string slicing renders $0.27 from 0.27877 with no math.
export function windowsCostLines(): string[] {
  return [
    'set "ORCA_STATUSLINE_COST="',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_JSON:*"total_cost_usd"=!"',
    'if "!ORCA_STATUSLINE_REST!"=="!ORCA_STATUSLINE_JSON!" goto :orca_statusline_cost_done',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_REST:*:=!"',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_REST:~0,24!"',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_REST: =!"',
    'set "ORCA_STATUSLINE_COST_NUM="',
    'for /f "delims=,}" %%c in ("x!ORCA_STATUSLINE_REST!") do if not defined ORCA_STATUSLINE_COST_NUM set "ORCA_STATUSLINE_COST_NUM=%%c"',
    'set "ORCA_STATUSLINE_COST_NUM=!ORCA_STATUSLINE_COST_NUM:~1!"',
    // Why reject scientific notation outright: "5e-7" would otherwise render as $5. The
    // replacement test is case-insensitive, so it covers E too.
    'if defined ORCA_STATUSLINE_COST_NUM if not "!ORCA_STATUSLINE_COST_NUM:e=!"=="!ORCA_STATUSLINE_COST_NUM!" set "ORCA_STATUSLINE_COST_NUM="',
    'if not defined ORCA_STATUSLINE_COST_NUM goto :orca_statusline_cost_done',
    'set "ORCA_STATUSLINE_COST_INT="',
    'for /f "delims=." %%c in ("x!ORCA_STATUSLINE_COST_NUM!") do if not defined ORCA_STATUSLINE_COST_INT set "ORCA_STATUSLINE_COST_INT=%%c"',
    'set "ORCA_STATUSLINE_COST_INT=!ORCA_STATUSLINE_COST_INT:~1!"',
    'if defined ORCA_STATUSLINE_COST_INT for /f "delims=0123456789" %%d in ("!ORCA_STATUSLINE_COST_INT!") do set "ORCA_STATUSLINE_COST_INT="',
    'if defined ORCA_STATUSLINE_COST_INT if not "!ORCA_STATUSLINE_COST_INT:~4!"=="" set "ORCA_STATUSLINE_COST_INT="',
    'if not defined ORCA_STATUSLINE_COST_INT goto :orca_statusline_cost_done',
    'set "ORCA_STATUSLINE_COST_DEC=!ORCA_STATUSLINE_COST_NUM:*.=!"',
    'if "!ORCA_STATUSLINE_COST_DEC!"=="!ORCA_STATUSLINE_COST_NUM!" set "ORCA_STATUSLINE_COST_DEC="',
    'if defined ORCA_STATUSLINE_COST_DEC set "ORCA_STATUSLINE_COST_DEC=!ORCA_STATUSLINE_COST_DEC:~0,2!"',
    'if defined ORCA_STATUSLINE_COST_DEC for /f "delims=0123456789" %%d in ("!ORCA_STATUSLINE_COST_DEC!") do set "ORCA_STATUSLINE_COST_DEC="',
    // A single surviving decimal pads to two so $0.5 and $0.50 cannot alternate between ticks.
    'if defined ORCA_STATUSLINE_COST_DEC if "!ORCA_STATUSLINE_COST_DEC:~1!"=="" set "ORCA_STATUSLINE_COST_DEC=!ORCA_STATUSLINE_COST_DEC!0"',
    'set "ORCA_STATUSLINE_COST=$!ORCA_STATUSLINE_COST_INT!"',
    'if defined ORCA_STATUSLINE_COST_DEC set "ORCA_STATUSLINE_COST=$!ORCA_STATUSLINE_COST_INT!.!ORCA_STATUSLINE_COST_DEC!"',
    ':orca_statusline_cost_done'
  ]
}
