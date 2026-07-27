import { WINDOWS_HOOK_STDIN_READER } from '../agent-hooks/hook-stdin-contract'
import {
  STATUSLINE_RESET_MARK_ASCII,
  windowsContextTrendLines,
  windowsGaugeLines,
  windowsGaugeTableLine,
  windowsResetCountdownLines
} from './statusline-usage-gauge'
import {
  CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS,
  CLAUDE_STATUSLINE_PATHNAME
} from '../../shared/claude-statusline-rate-limits'

const STATUSLINE_CLEANUP_LABEL = 'orca_statusline_cleanup'
const STATUSLINE_PROBE_LABEL = 'orca_statusline_probe'
const STATUSLINE_EMIT_LABEL = 'orca_statusline_emit'
const STATUSLINE_INTRO_LABEL = 'orca_statusline_intro'
const STATUSLINE_ACCOUNT_LABEL = 'orca_statusline_account'
const STATUSLINE_SEVEN_LABEL = 'orca_statusline_quota_seven'
const STATUSLINE_TREND_WRITE_LABEL = 'orca_statusline_trend_write'
const STATUSLINE_TREND_DONE_LABEL = 'orca_statusline_trend_done'
const STATUSLINE_RESET_DONE_LABEL = 'orca_statusline_reset_done'
const STATUSLINE_RESET_FIELD_LABEL = 'orca_statusline_field_reset'
const STATUSLINE_BAR_TABLE_VAR = 'ORCA_STATUSLINE_BARS'
// Why 96: the POSIX branch's budget, kept identical so a pane renders the same width on either OS.
// Why a raw substring test still measures it correctly here: this variant is ASCII by contract,
// so one byte is one column — the POSIX branch has to count columns because its bars are not.
const STATUSLINE_MAX_WIDTH = 96

/**
 * One `rate_limits` window, bounded at its own first `}`.
 *
 * Why bound before searching: five_hour and seven_day both carry used_percentage, so a window
 * that omits its own would otherwise borrow its sibling's — and any key reorder swaps the two.
 * Quotes become commas first because `for /f` cannot take a quote-bearing string, and the `x`
 * prefix keeps token 1 non-empty so a leading `}` can never shift the split.
 */
function quotaWindowLines(windowKey: string, targetVar: string, doneLabel: string): string[] {
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
function budgetedFieldLines(valueVar: string, rendered: string, nextLabel: string): string[] {
  return [
    `if not defined ${valueVar} goto :${nextLabel}`,
    `set "ORCA_STATUSLINE_NEXT=${rendered}"`,
    `if defined ORCA_STATUSLINE_LINE set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_LINE! | ${rendered}"`,
    `if not "!ORCA_STATUSLINE_NEXT:~${STATUSLINE_MAX_WIDTH}!"=="" goto :${STATUSLINE_EMIT_LABEL}`,
    'set "ORCA_STATUSLINE_LINE=!ORCA_STATUSLINE_NEXT!"'
  ]
}

/**
 * cmd.exe variant of the managed statusline script.
 *
 * Why its own module: the POSIX and batch generators share nothing but the payload contract,
 * and keeping both in one file pushed it past the line cap.
 */
export function getWindowsManagedStatusLineScript(): string {
  return [
    '@echo off',
    'setlocal',
    // Why: sessions outside Orca (no pane key) hit this settings.json too — they must still
    // print, so capture always runs; %RANDOM% only risks a same-second cosmetic garble here.
    'if not "%ORCA_PANE_KEY%"=="" goto :orca_statusline_pane_id',
    'set "ORCA_STATUSLINE_PANE_ID=orphan-%RANDOM%"',
    'goto :orca_statusline_capture',
    ':orca_statusline_pane_id',
    // Why: current keys end in a UUID; replacing the legacy delimiter also keeps surviving numeric-pane keys filename-safe.
    'set "ORCA_STATUSLINE_PANE_ID=%ORCA_PANE_KEY:~-36%"',
    'set "ORCA_STATUSLINE_PANE_ID=%ORCA_STATUSLINE_PANE_ID::=_%"',
    ':orca_statusline_capture',
    // Why: cmd has no builtin stdin capture, so buffer the payload in a per-pane temp file
    // (%RANDOM% collides across same-second cmd spawns) to guard before any curl spawn.
    'set "ORCA_STATUSLINE_PAYLOAD_FILE=%TEMP%\\orca-claude-statusline-%ORCA_STATUSLINE_PANE_ID%.tmp"',
    `${WINDOWS_HOOK_STDIN_READER} >"%ORCA_STATUSLINE_PAYLOAD_FILE%" 2>nul`,
    // Why: capture with plain expansion (a for-var set survives quotes/&), then parse under
    // delayed expansion so payload content is never re-tokenized as cmd syntax.
    'set "ORCA_STATUSLINE_JSON="',
    'for /f "usebackq delims=" %%x in ("%ORCA_STATUSLINE_PAYLOAD_FILE%") do if not defined ORCA_STATUSLINE_JSON set "ORCA_STATUSLINE_JSON=%%x"',
    'setlocal enabledelayedexpansion',
    'set "ORCA_STATUSLINE_MODEL="',
    'set "ORCA_STATUSLINE_CTX="',
    'set "ORCA_STATUSLINE_LINE="',
    `if not defined ORCA_STATUSLINE_JSON goto :${STATUSLINE_EMIT_LABEL}`,
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
    'if defined ORCA_STATUSLINE_MODEL goto :orca_statusline_context',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_JSON:*"model"=!"',
    'if "!ORCA_STATUSLINE_REST!"=="!ORCA_STATUSLINE_JSON!" goto :orca_statusline_context',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_REST:*"id"=!"',
    'if "!ORCA_STATUSLINE_NEXT!"=="!ORCA_STATUSLINE_REST!" goto :orca_statusline_context',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:*"=!"',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:"=,!"',
    'if "!ORCA_STATUSLINE_NEXT:~0,1!"=="," goto :orca_statusline_context',
    'for /f "delims=," %%m in ("!ORCA_STATUSLINE_NEXT!") do if not defined ORCA_STATUSLINE_MODEL set "ORCA_STATUSLINE_MODEL=%%m"',
    ':orca_statusline_context',
    // Why: scope the search to context_window so rate_limits' used_percentage (a different
    // metric) can never masquerade as context usage; cap at 16 chars before tokenizing.
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_JSON:*"context_window"=!"',
    'if "!ORCA_STATUSLINE_REST!"=="!ORCA_STATUSLINE_JSON!" goto :orca_statusline_quota',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_REST:*"used_percentage"=!"',
    'if "!ORCA_STATUSLINE_NEXT!"=="!ORCA_STATUSLINE_REST!" goto :orca_statusline_quota',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:*:=!"',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:~0,16!"',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT:"=,!"',
    'set "ORCA_STATUSLINE_NEXT=!ORCA_STATUSLINE_NEXT: =!"',
    'for /f "delims=.,}" %%p in ("!ORCA_STATUSLINE_NEXT!") do if not defined ORCA_STATUSLINE_CTX set "ORCA_STATUSLINE_CTX=%%p"',
    'for /f "delims=0123456789" %%d in ("!ORCA_STATUSLINE_CTX!") do set "ORCA_STATUSLINE_CTX="',
    'if defined ORCA_STATUSLINE_CTX if not "!ORCA_STATUSLINE_CTX:~3!"=="" set "ORCA_STATUSLINE_CTX="',
    ':orca_statusline_quota',
    'set "ORCA_STATUSLINE_FIVE="',
    'set "ORCA_STATUSLINE_SEVEN="',
    'set "ORCA_STATUSLINE_LIMITS=!ORCA_STATUSLINE_JSON:*"rate_limits"=!"',
    `if "!ORCA_STATUSLINE_LIMITS!"=="!ORCA_STATUSLINE_JSON!" goto :${STATUSLINE_ACCOUNT_LABEL}`,
    ...quotaWindowLines('five_hour', 'ORCA_STATUSLINE_FIVE', STATUSLINE_SEVEN_LABEL),
    `:${STATUSLINE_SEVEN_LABEL}`,
    ...quotaWindowLines('seven_day', 'ORCA_STATUSLINE_SEVEN', STATUSLINE_ACCOUNT_LABEL),
    `:${STATUSLINE_ACCOUNT_LABEL}`,
    'set "ORCA_STATUSLINE_ACCOUNT="',
    'set "ORCA_STATUSLINE_ACCT_KEY="',
    `if not defined CLAUDE_CONFIG_DIR goto :${STATUSLINE_INTRO_LABEL}`,
    // Why key the cache on the config dir's own directory name: it is the account id, so a
    // repinned worktree can never render the previous account from a stale cache. The `.` pads
    // the comparison so the literal never ends in a backslash, which would eat the closing quote.
    'set "ORCA_STATUSLINE_ACCT_DIR=!CLAUDE_CONFIG_DIR!"',
    'if "!ORCA_STATUSLINE_ACCT_DIR:~-1!."=="\\." set "ORCA_STATUSLINE_ACCT_DIR=!ORCA_STATUSLINE_ACCT_DIR:~0,-1!"',
    'if /i "!ORCA_STATUSLINE_ACCT_DIR:~-5!"=="\\auth" set "ORCA_STATUSLINE_ACCT_DIR=!ORCA_STATUSLINE_ACCT_DIR:~0,-5!"',
    'for %%d in ("!ORCA_STATUSLINE_ACCT_DIR!") do set "ORCA_STATUSLINE_ACCT_KEY=%%~nxd"',
    // Why only a length bound: %%~nx yields one existing directory name, which by construction
    // carries no separator or reserved character, so the temp path stays inside %TEMP%.
    'if defined ORCA_STATUSLINE_ACCT_KEY if not "!ORCA_STATUSLINE_ACCT_KEY:~64!"=="" set "ORCA_STATUSLINE_ACCT_KEY="',
    `if not defined ORCA_STATUSLINE_ACCT_KEY goto :${STATUSLINE_INTRO_LABEL}`,
    'set "ORCA_STATUSLINE_ACCT_CACHE=%TEMP%\\orca-claude-statusline-acct-!ORCA_STATUSLINE_ACCT_KEY!.tmp"',
    'if exist "!ORCA_STATUSLINE_ACCT_CACHE!" set /p ORCA_STATUSLINE_ACCOUNT=<"!ORCA_STATUSLINE_ACCT_CACHE!"',
    'if defined ORCA_STATUSLINE_ACCOUNT goto :orca_statusline_account_render',
    // Why read the vault at most once per account: this runs ~3x/sec, so the cache is what keeps
    // the account label free. A miss costs one small read, never a subprocess.
    'set "ORCA_STATUSLINE_VAULT=!CLAUDE_CONFIG_DIR!\\oauth-account.json"',
    `if not exist "!ORCA_STATUSLINE_VAULT!" goto :${STATUSLINE_INTRO_LABEL}`,
    // Why join every line: the vault ships pretty-printed, so a first-line-only capture would
    // never see emailAddress.
    'set "ORCA_STATUSLINE_ACCT_RAW="',
    'for /f "usebackq delims=" %%a in ("!ORCA_STATUSLINE_VAULT!") do set "ORCA_STATUSLINE_ACCT_RAW=!ORCA_STATUSLINE_ACCT_RAW!%%a"',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_ACCT_RAW:*"emailAddress"=!"',
    `if "!ORCA_STATUSLINE_REST!"=="!ORCA_STATUSLINE_ACCT_RAW!" goto :${STATUSLINE_INTRO_LABEL}`,
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_REST:*"=!"',
    'set "ORCA_STATUSLINE_REST=!ORCA_STATUSLINE_REST:"=,!"',
    `if "!ORCA_STATUSLINE_REST:~0,1!"=="," goto :${STATUSLINE_INTRO_LABEL}`,
    'for /f "delims=," %%e in ("!ORCA_STATUSLINE_REST!") do if not defined ORCA_STATUSLINE_ACCOUNT set "ORCA_STATUSLINE_ACCOUNT=%%e"',
    // Why the defined guard: echoing an empty variable writes "ECHO is off." into the cache, and
    // that string would then be this account's label on every later tick.
    'if defined ORCA_STATUSLINE_ACCOUNT (>"!ORCA_STATUSLINE_ACCT_CACHE!" echo !ORCA_STATUSLINE_ACCOUNT!)',
    ':orca_statusline_account_render',
    `if not defined ORCA_STATUSLINE_ACCOUNT goto :${STATUSLINE_INTRO_LABEL}`,
    // Why drop the domain: the local part is what distinguishes several accounts on one domain,
    // and the whole line has to survive a narrow pane.
    'if "!ORCA_STATUSLINE_ACCOUNT:@=!"=="!ORCA_STATUSLINE_ACCOUNT!" goto :orca_statusline_account_bound',
    'for /f "delims=@" %%e in ("!ORCA_STATUSLINE_ACCOUNT!") do set "ORCA_STATUSLINE_ACCOUNT=%%e@"',
    ':orca_statusline_account_bound',
    // Why bound the local part: an unusually long address is the one field that can blow the
    // line, and the ladder would then drop quota to pay for it. ASCII "..." where POSIX renders
    // "…" — writeManagedScript emits UTF-8 and cmd reads the file in the OEM codepage, so the
    // ellipsis would arrive garbled; 18+4 keeps the same 22-character bound as POSIX.
    `if "!ORCA_STATUSLINE_ACCOUNT:~21!"=="" goto :${STATUSLINE_INTRO_LABEL}`,
    'set "ORCA_STATUSLINE_ACCOUNT=!ORCA_STATUSLINE_ACCOUNT:~0,18!...@"',
    `:${STATUSLINE_INTRO_LABEL}`,
    // Why announce once per pane: the line is requested ~3x/sec, so a banner on every tick would
    // strobe. Separate marker from the POST stamp — that one governs the network, not the render.
    // Why not the orphan pane id: it carries %RANDOM%, so every tick would look like a new pane.
    'set "ORCA_STATUSLINE_INTRO="',
    'set "ORCA_STATUSLINE_INTRO_KEY="',
    'if defined ORCA_PANE_KEY set "ORCA_STATUSLINE_INTRO_KEY=!ORCA_STATUSLINE_PANE_ID!"',
    'if not defined ORCA_STATUSLINE_INTRO_KEY set "ORCA_STATUSLINE_INTRO_KEY=!ORCA_STATUSLINE_ACCT_KEY!"',
    'if not defined ORCA_STATUSLINE_INTRO_KEY goto :orca_statusline_compose',
    'set "ORCA_STATUSLINE_INTRO_STAMP=%TEMP%\\orca-claude-statusline-intro-!ORCA_STATUSLINE_INTRO_KEY!.tmp"',
    'if exist "!ORCA_STATUSLINE_INTRO_STAMP!" goto :orca_statusline_compose',
    'set "ORCA_STATUSLINE_INTRO=Orca by Ab2Web"',
    // Why break: an internal no-op, so the marker costs a 0-byte file and never a spawn.
    'break>"!ORCA_STATUSLINE_INTRO_STAMP!" 2>nul',
    ':orca_statusline_compose',
    ...windowsContextTrendLines(STATUSLINE_TREND_DONE_LABEL, STATUSLINE_TREND_WRITE_LABEL),
    ...windowsResetCountdownLines(STATUSLINE_RESET_DONE_LABEL),
    windowsGaugeTableLine(STATUSLINE_BAR_TABLE_VAR),
    ...windowsGaugeLines(
      'ORCA_STATUSLINE_CTX',
      'ORCA_STATUSLINE_CTX_BAR',
      STATUSLINE_BAR_TABLE_VAR
    ),
    ...windowsGaugeLines(
      'ORCA_STATUSLINE_FIVE',
      'ORCA_STATUSLINE_FIVE_BAR',
      STATUSLINE_BAR_TABLE_VAR
    ),
    ...windowsGaugeLines(
      'ORCA_STATUSLINE_SEVEN',
      'ORCA_STATUSLINE_SEVEN_BAR',
      STATUSLINE_BAR_TABLE_VAR
    ),
    // Why the field is assembled before it is appended: an absent bar or trend must leave no
    // stray space behind, and cmd has no conditional-expansion form to do it inline.
    'set "ORCA_STATUSLINE_CTX_FIELD="',
    'if defined ORCA_STATUSLINE_CTX set "ORCA_STATUSLINE_CTX_FIELD=ctx !ORCA_STATUSLINE_CTX!%%"',
    'if defined ORCA_STATUSLINE_CTX_BAR set "ORCA_STATUSLINE_CTX_FIELD=ctx !ORCA_STATUSLINE_CTX_BAR! !ORCA_STATUSLINE_CTX!%%"',
    'if defined ORCA_STATUSLINE_CTX_FIELD if defined ORCA_STATUSLINE_TREND set "ORCA_STATUSLINE_CTX_FIELD=!ORCA_STATUSLINE_CTX_FIELD! !ORCA_STATUSLINE_TREND!"',
    // Why identity, model and context are the fixed prefix: all three are short and bounded, so
    // dropping them buys almost no width while costing the two things the line exists to say.
    'set "ORCA_STATUSLINE_LINE=!ORCA_STATUSLINE_INTRO!"',
    'if defined ORCA_STATUSLINE_MODEL if defined ORCA_STATUSLINE_LINE set "ORCA_STATUSLINE_LINE=!ORCA_STATUSLINE_LINE! | !ORCA_STATUSLINE_MODEL!"',
    'if defined ORCA_STATUSLINE_MODEL if not defined ORCA_STATUSLINE_LINE set "ORCA_STATUSLINE_LINE=!ORCA_STATUSLINE_MODEL!"',
    'if defined ORCA_STATUSLINE_CTX_FIELD if defined ORCA_STATUSLINE_LINE set "ORCA_STATUSLINE_LINE=!ORCA_STATUSLINE_LINE! | !ORCA_STATUSLINE_CTX_FIELD!"',
    'if defined ORCA_STATUSLINE_CTX_FIELD if not defined ORCA_STATUSLINE_LINE set "ORCA_STATUSLINE_LINE=!ORCA_STATUSLINE_CTX_FIELD!"',
    // Why a length budget instead of reading the terminal width: width needs a subprocess, which
    // is exactly what this path must not do. Appending in priority order makes the ladder fall
    // out of the budget on its own.
    ...budgetedFieldLines(
      'ORCA_STATUSLINE_ACCOUNT',
      '@!ORCA_STATUSLINE_ACCOUNT!',
      'orca_statusline_field_five'
    ),
    ':orca_statusline_field_five',
    ...budgetedFieldLines(
      'ORCA_STATUSLINE_FIVE',
      '5h !ORCA_STATUSLINE_FIVE_BAR! !ORCA_STATUSLINE_FIVE!%%',
      'orca_statusline_field_seven'
    ),
    ':orca_statusline_field_seven',
    ...budgetedFieldLines(
      'ORCA_STATUSLINE_SEVEN',
      '7d !ORCA_STATUSLINE_SEVEN_BAR! !ORCA_STATUSLINE_SEVEN!%%',
      STATUSLINE_RESET_FIELD_LABEL
    ),
    `:${STATUSLINE_RESET_FIELD_LABEL}`,
    // Why last: level and direction are what the line exists to say, and a reset is context on
    // top of them — never worth the weekly quota it would push off a narrow pane.
    ...budgetedFieldLines(
      'ORCA_STATUSLINE_RESET',
      `${STATUSLINE_RESET_MARK_ASCII} !ORCA_STATUSLINE_RESET!`,
      STATUSLINE_EMIT_LABEL
    ),
    `:${STATUSLINE_EMIT_LABEL}`,
    // Why: stdout IS the status line — echo( survives arbitrary expanded content.
    'if defined ORCA_STATUSLINE_LINE echo(!ORCA_STATUSLINE_LINE!',
    'endlocal',
    // Why: no pane key means no Orca to feed — print-only sessions never post.
    `if "%ORCA_PANE_KEY%"=="" goto :${STATUSLINE_CLEANUP_LABEL}`,
    // Why: an all-builtin seconds-of-day throttle avoids spawning findstr+curl on every streaming tick.
    'set "ORCA_STATUSLINE_STAMP_FILE=%TEMP%\\orca-claude-statusline-last-%ORCA_STATUSLINE_PANE_ID%.tmp"',
    'set "ORCA_STATUSLINE_NOW="',
    'set "ORCA_STATUSLINE_TIME=%TIME: =0%"',
    'for /f "tokens=1-3 delims=:.," %%a in ("%ORCA_STATUSLINE_TIME%") do set /a "ORCA_STATUSLINE_NOW=(1%%a %% 100)*3600+(1%%b %% 100)*60+(1%%c %% 100)" 2>nul',
    'set "ORCA_STATUSLINE_LAST="',
    'set "ORCA_STATUSLINE_ELAPSED="',
    'if exist "%ORCA_STATUSLINE_STAMP_FILE%" set /p ORCA_STATUSLINE_LAST=<"%ORCA_STATUSLINE_STAMP_FILE%"',
    'if defined ORCA_STATUSLINE_LAST for /f "delims=0123456789" %%d in ("%ORCA_STATUSLINE_LAST%") do set "ORCA_STATUSLINE_LAST="',
    'if defined ORCA_STATUSLINE_NOW if defined ORCA_STATUSLINE_LAST set /a "ORCA_STATUSLINE_ELAPSED=ORCA_STATUSLINE_NOW-ORCA_STATUSLINE_LAST" 2>nul',
    `if not defined ORCA_STATUSLINE_ELAPSED goto :${STATUSLINE_PROBE_LABEL}`,
    `if %ORCA_STATUSLINE_ELAPSED% GEQ 0 if %ORCA_STATUSLINE_ELAPSED% LSS ${CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS} goto :${STATUSLINE_CLEANUP_LABEL}`,
    `:${STATUSLINE_PROBE_LABEL}`,
    // Why: rate_limits appears only for Claude.ai-subscriber sessions after the first API response; the
    // statusline ticks ~3x/sec during streaming, so skip the endpoint call and curl spawn otherwise.
    // Why: \" is the MSVC argv escape — findstr sees the quoted JSON key, so a cwd containing rate_limits can't false-match (POSIX guard parity).
    '"%SystemRoot%\\System32\\findstr.exe" /c:\\"rate_limits\\" "%ORCA_STATUSLINE_PAYLOAD_FILE%" >nul 2>nul',
    `if errorlevel 1 goto :${STATUSLINE_CLEANUP_LABEL}`,
    // Why: call the endpoint file to refresh port/token — a PTY that survived an Orca restart carries stale env; falls through to PTY env if missing.
    'if defined ORCA_AGENT_HOOK_ENDPOINT if exist "%ORCA_AGENT_HOOK_ENDPOINT%" call "%ORCA_AGENT_HOOK_ENDPOINT%" 2>nul',
    `if "%ORCA_AGENT_HOOK_PORT%"=="" goto :${STATUSLINE_CLEANUP_LABEL}`,
    `if "%ORCA_AGENT_HOOK_TOKEN%"=="" goto :${STATUSLINE_CLEANUP_LABEL}`,
    // Why: stamp only when a post is certain, so skipped ticks (no rate_limits, missing port/token) never push the next allowed post out.
    'if defined ORCA_STATUSLINE_NOW (>"%ORCA_STATUSLINE_STAMP_FILE%" echo %ORCA_STATUSLINE_NOW%)',
    // Why: pre-build the field from an always-defined variable so an unset CLAUDE_CONFIG_DIR posts
    // empty (matching POSIX and the null attribution snapshot), never a literal %VAR% token.
    'set "ORCA_STATUSLINE_CONFIG_DIR_FIELD=configDir="',
    'if defined CLAUDE_CONFIG_DIR set "ORCA_STATUSLINE_CONFIG_DIR_FIELD=configDir=%CLAUDE_CONFIG_DIR%"',
    [
      '"%SystemRoot%\\System32\\curl.exe" -sS -X POST',
      `"http://127.0.0.1:%ORCA_AGENT_HOOK_PORT%${CLAUDE_STATUSLINE_PATHNAME}"`,
      '--connect-timeout 0.5 --max-time 1.5',
      '-H "Content-Type: application/x-www-form-urlencoded"',
      '-H "X-Orca-Agent-Hook-Token: %ORCA_AGENT_HOOK_TOKEN%"',
      '--data-urlencode "paneKey=%ORCA_PANE_KEY%"',
      '--data-urlencode "%ORCA_STATUSLINE_CONFIG_DIR_FIELD%"',
      '--data-urlencode "env=%ORCA_AGENT_HOOK_ENV%"',
      '--data-urlencode "version=%ORCA_AGENT_HOOK_VERSION%"',
      '--data-urlencode "payload@%ORCA_STATUSLINE_PAYLOAD_FILE%"',
      '>nul 2>&1'
    ].join(' '),
    `:${STATUSLINE_CLEANUP_LABEL}`,
    'del "%ORCA_STATUSLINE_PAYLOAD_FILE%" >nul 2>nul',
    'exit /b 0',
    ''
  ].join('\r\n')
}
