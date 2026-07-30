import {
  normalizeClaudeStatusLineItemOrder,
  normalizeClaudeStatusLineItems,
  type ClaudeStatusLineItemKey,
  type ClaudeStatusLineItems
} from '../../shared/claude-statusline-items'
import { STATUSLINE_MAX_WIDTH } from '../../shared/claude-statusline-line-model'
import { WINDOWS_HOOK_STDIN_READER } from '../agent-hooks/hook-stdin-contract'
import {
  budgetedFieldLines,
  quotaWindowLines,
  STATUSLINE_WINDOWS_EMIT_LABEL,
  windowsContextLines,
  windowsCostLines,
  windowsModelLines,
  windowsProjectLines
} from './statusline-windows-fields'
import {
  deriveStatusLineBarCells,
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
const STATUSLINE_EMIT_LABEL = STATUSLINE_WINDOWS_EMIT_LABEL
const STATUSLINE_INTRO_LABEL = 'orca_statusline_intro'
const STATUSLINE_ACCT_KEY_DONE_LABEL = 'orca_statusline_acct_key_done'
const STATUSLINE_SEVEN_LABEL = 'orca_statusline_quota_seven'
const STATUSLINE_QUOTA_DONE_LABEL = 'orca_statusline_quota_done'
const STATUSLINE_ITEM_LABEL_PREFIX = 'orca_statusline_item_'
const STATUSLINE_TREND_WRITE_LABEL = 'orca_statusline_trend_write'
const STATUSLINE_TREND_DONE_LABEL = 'orca_statusline_trend_done'
const STATUSLINE_RESET_DONE_LABEL = 'orca_statusline_reset_done'
const STATUSLINE_BAR_TABLE_VAR = 'ORCA_STATUSLINE_BARS'

/**
 * cmd.exe variant of the managed statusline script.
 *
 * Why its own module: the POSIX and batch generators share nothing but the payload contract,
 * and keeping both in one file pushed it past the line cap.
 */
export function getWindowsManagedStatusLineScript(
  items?: Partial<ClaudeStatusLineItems>,
  order?: readonly ClaudeStatusLineItemKey[]
): string {
  const resolved = normalizeClaudeStatusLineItems(items)
  const resolvedOrder = normalizeClaudeStatusLineItemOrder(order)
  const cells = deriveStatusLineBarCells(resolved)
  const anyQuota = resolved.fiveHourQuota || resolved.sevenDayQuota
  const anyBar = resolved.context || anyQuota

  // Why the field is appended through an always-defined LINE check pair: cmd has no
  // conditional-expansion form, so an absent field must leave no stray separator behind.
  const appendLines = (valueVar: string): string[] => [
    `if defined ${valueVar} if defined ORCA_STATUSLINE_LINE set "ORCA_STATUSLINE_LINE=!ORCA_STATUSLINE_LINE! | !${valueVar}!"`,
    `if defined ${valueVar} if not defined ORCA_STATUSLINE_LINE set "ORCA_STATUSLINE_LINE=!${valueVar}!"`
  ]
  // The composition block for each enabled item, emitted in the configured order. Identity
  // fields append unconditionally; budgeted fields fall in configured order when columns run
  // out — by default the account first, then session quota, weekly quota, cost, countdown.
  const composeBlocks = new Map<ClaudeStatusLineItemKey, (nextLabel: string) => string[]>()
  if (resolved.project) {
    composeBlocks.set('project', () => appendLines('ORCA_STATUSLINE_PROJECT'))
  }
  if (resolved.model) {
    composeBlocks.set('model', () => appendLines('ORCA_STATUSLINE_MODEL'))
  }
  if (resolved.context) {
    composeBlocks.set('context', () => appendLines('ORCA_STATUSLINE_CTX_FIELD'))
  }
  if (resolved.account) {
    composeBlocks.set('account', (nextLabel) =>
      budgetedFieldLines('ORCA_STATUSLINE_ACCOUNT', '@!ORCA_STATUSLINE_ACCOUNT!', nextLabel)
    )
  }
  if (resolved.fiveHourQuota) {
    composeBlocks.set('fiveHourQuota', (nextLabel) =>
      budgetedFieldLines(
        'ORCA_STATUSLINE_FIVE',
        '5h !ORCA_STATUSLINE_FIVE_BAR! !ORCA_STATUSLINE_FIVE!%%',
        nextLabel
      )
    )
  }
  if (resolved.sevenDayQuota) {
    composeBlocks.set('sevenDayQuota', (nextLabel) =>
      budgetedFieldLines(
        'ORCA_STATUSLINE_SEVEN',
        '7d !ORCA_STATUSLINE_SEVEN_BAR! !ORCA_STATUSLINE_SEVEN!%%',
        nextLabel
      )
    )
  }
  if (resolved.cost) {
    composeBlocks.set('cost', (nextLabel) =>
      budgetedFieldLines('ORCA_STATUSLINE_COST', '!ORCA_STATUSLINE_COST!', nextLabel)
    )
  }
  if (resolved.resetCountdown) {
    composeBlocks.set('resetCountdown', (nextLabel) =>
      budgetedFieldLines(
        'ORCA_STATUSLINE_RESET',
        `${STATUSLINE_RESET_MARK_ASCII} !ORCA_STATUSLINE_RESET!`,
        nextLabel
      )
    )
  }
  const orderedBlocks = resolvedOrder
    .filter((key) => composeBlocks.has(key))
    .map((key) => composeBlocks.get(key)!)
  // Why every block is labeled: a budgeted field that overflows or has no value must land on
  // the block right after it, whichever class that block is — the label is the only jump target
  // cmd offers.
  const compositionLines = orderedBlocks.flatMap((block, index) => [
    `:${STATUSLINE_ITEM_LABEL_PREFIX}${index}`,
    ...block(
      index + 1 < orderedBlocks.length
        ? `${STATUSLINE_ITEM_LABEL_PREFIX}${index + 1}`
        : STATUSLINE_EMIT_LABEL
    )
  ])

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
    ...(resolved.model ? windowsModelLines() : []),
    ...(resolved.context ? windowsContextLines() : []),
    ...(resolved.project ? windowsProjectLines() : []),
    ...(resolved.cost ? windowsCostLines() : []),
    ...(anyQuota
      ? [
          'set "ORCA_STATUSLINE_FIVE="',
          'set "ORCA_STATUSLINE_SEVEN="',
          'set "ORCA_STATUSLINE_LIMITS=!ORCA_STATUSLINE_JSON:*"rate_limits"=!"',
          `if "!ORCA_STATUSLINE_LIMITS!"=="!ORCA_STATUSLINE_JSON!" goto :${STATUSLINE_QUOTA_DONE_LABEL}`,
          ...(resolved.fiveHourQuota
            ? quotaWindowLines(
                'five_hour',
                'ORCA_STATUSLINE_FIVE',
                resolved.sevenDayQuota ? STATUSLINE_SEVEN_LABEL : STATUSLINE_QUOTA_DONE_LABEL
              )
            : []),
          ...(resolved.sevenDayQuota
            ? [
                ...(resolved.fiveHourQuota ? [`:${STATUSLINE_SEVEN_LABEL}`] : []),
                ...quotaWindowLines(
                  'seven_day',
                  'ORCA_STATUSLINE_SEVEN',
                  STATUSLINE_QUOTA_DONE_LABEL
                )
              ]
            : []),
          `:${STATUSLINE_QUOTA_DONE_LABEL}`
        ]
      : []),
    // Why key the account cache on the config dir's own directory name: it is the account id, so
    // a repinned worktree can never render the previous account from a stale cache. The key
    // derivation always runs — the intro marker and the reset countdown reuse it even when the
    // account item itself is turned off. The `.` pads the comparison so the literal never ends
    // in a backslash, which would eat the closing quote.
    'set "ORCA_STATUSLINE_ACCOUNT="',
    'set "ORCA_STATUSLINE_ACCT_KEY="',
    `if not defined CLAUDE_CONFIG_DIR goto :${STATUSLINE_ACCT_KEY_DONE_LABEL}`,
    'set "ORCA_STATUSLINE_ACCT_DIR=!CLAUDE_CONFIG_DIR!"',
    'if "!ORCA_STATUSLINE_ACCT_DIR:~-1!."=="\\." set "ORCA_STATUSLINE_ACCT_DIR=!ORCA_STATUSLINE_ACCT_DIR:~0,-1!"',
    'if /i "!ORCA_STATUSLINE_ACCT_DIR:~-5!"=="\\auth" set "ORCA_STATUSLINE_ACCT_DIR=!ORCA_STATUSLINE_ACCT_DIR:~0,-5!"',
    'for %%d in ("!ORCA_STATUSLINE_ACCT_DIR!") do set "ORCA_STATUSLINE_ACCT_KEY=%%~nxd"',
    // Why only a length bound: %%~nx yields one existing directory name, which by construction
    // carries no separator or reserved character, so the temp path stays inside %TEMP%.
    'if defined ORCA_STATUSLINE_ACCT_KEY if not "!ORCA_STATUSLINE_ACCT_KEY:~64!"=="" set "ORCA_STATUSLINE_ACCT_KEY="',
    `:${STATUSLINE_ACCT_KEY_DONE_LABEL}`,
    ...(resolved.account
      ? [
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
          // Why drop the domain with no trailing @: the rendered field's leading @ is already the
          // account mark, so the elision's own @ stacked into a double sigil (@user@) on every line.
          'if "!ORCA_STATUSLINE_ACCOUNT:@=!"=="!ORCA_STATUSLINE_ACCOUNT!" goto :orca_statusline_account_bound',
          'for /f "delims=@" %%e in ("!ORCA_STATUSLINE_ACCOUNT!") do set "ORCA_STATUSLINE_ACCOUNT=%%e"',
          ':orca_statusline_account_bound',
          // Why bound the local part: an unusually long address is the one field that can blow the
          // line, and the ladder would then drop quota to pay for it. ASCII "..." where POSIX renders
          // "…" — writeManagedScript emits UTF-8 and cmd reads the file in the OEM codepage, so the
          // ellipsis would arrive garbled; 18+3 keeps the same 21-character bound as POSIX's 20+1.
          `if "!ORCA_STATUSLINE_ACCOUNT:~21!"=="" goto :${STATUSLINE_INTRO_LABEL}`,
          'set "ORCA_STATUSLINE_ACCOUNT=!ORCA_STATUSLINE_ACCOUNT:~0,18!..."'
        ]
      : []),
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
    ...(resolved.context
      ? windowsContextTrendLines(STATUSLINE_TREND_DONE_LABEL, STATUSLINE_TREND_WRITE_LABEL)
      : []),
    ...(resolved.resetCountdown ? windowsResetCountdownLines(STATUSLINE_RESET_DONE_LABEL) : []),
    ...(anyBar ? [windowsGaugeTableLine(STATUSLINE_BAR_TABLE_VAR, cells)] : []),
    ...(resolved.context
      ? windowsGaugeLines(
          'ORCA_STATUSLINE_CTX',
          'ORCA_STATUSLINE_CTX_BAR',
          STATUSLINE_BAR_TABLE_VAR,
          cells
        )
      : []),
    ...(resolved.fiveHourQuota
      ? windowsGaugeLines(
          'ORCA_STATUSLINE_FIVE',
          'ORCA_STATUSLINE_FIVE_BAR',
          STATUSLINE_BAR_TABLE_VAR,
          cells
        )
      : []),
    ...(resolved.sevenDayQuota
      ? windowsGaugeLines(
          'ORCA_STATUSLINE_SEVEN',
          'ORCA_STATUSLINE_SEVEN_BAR',
          STATUSLINE_BAR_TABLE_VAR,
          cells
        )
      : []),
    // Why the field is assembled before it is appended: an absent bar or trend must leave no
    // stray space behind, and cmd has no conditional-expansion form to do it inline.
    ...(resolved.context
      ? [
          'set "ORCA_STATUSLINE_CTX_FIELD="',
          'if defined ORCA_STATUSLINE_CTX set "ORCA_STATUSLINE_CTX_FIELD=ctx !ORCA_STATUSLINE_CTX!%%"',
          'if defined ORCA_STATUSLINE_CTX_BAR set "ORCA_STATUSLINE_CTX_FIELD=ctx !ORCA_STATUSLINE_CTX_BAR! !ORCA_STATUSLINE_CTX!%%"',
          'if defined ORCA_STATUSLINE_CTX_FIELD if defined ORCA_STATUSLINE_TREND set "ORCA_STATUSLINE_CTX_FIELD=!ORCA_STATUSLINE_CTX_FIELD! !ORCA_STATUSLINE_TREND!"'
        ]
      : []),
    // Why identity fields (project, model, context) always append: all are short and bounded,
    // so dropping them buys almost no width while costing the things the line exists to say —
    // and the project never falling is the point: it was the first thing the old cascade hid in
    // a narrow pane, and it is what the user most misses.
    // Why the budget resolves per tick instead of baking 96 in: the same PTY is viewed from
    // desktop and mobile, and the viewport refit rewrites cols between ticks. Claude Code
    // injects COLUMNS into this env on every invocation (v2.1.153+), so reading it is free —
    // measuring the width any other way needs a subprocess, which this path must not spawn.
    // Why reject a leading zero outright: cmd's numeric IF parses it as octal (and "08" falls
    // back to string comparison); the POSIX variant enforces the same grammar for parity.
    `set "ORCA_STATUSLINE_BUDGET=${STATUSLINE_MAX_WIDTH}"`,
    'set "ORCA_STATUSLINE_COLS="',
    'if defined COLUMNS set "ORCA_STATUSLINE_COLS=!COLUMNS!"',
    'if defined ORCA_STATUSLINE_COLS for /f "delims=0123456789" %%d in ("!ORCA_STATUSLINE_COLS!") do set "ORCA_STATUSLINE_COLS="',
    'if defined ORCA_STATUSLINE_COLS if "!ORCA_STATUSLINE_COLS:~0,1!"=="0" set "ORCA_STATUSLINE_COLS="',
    'if defined ORCA_STATUSLINE_COLS if not "!ORCA_STATUSLINE_COLS:~4!"=="" set "ORCA_STATUSLINE_COLS="',
    `if defined ORCA_STATUSLINE_COLS if !ORCA_STATUSLINE_COLS! LSS ${STATUSLINE_MAX_WIDTH} set "ORCA_STATUSLINE_BUDGET=!ORCA_STATUSLINE_COLS!"`,
    'set "ORCA_STATUSLINE_LINE=!ORCA_STATUSLINE_INTRO!"',
    // Appending in configured order makes the budgeted fields fall out of the budget on their own.
    'set "ORCA_STATUSLINE_FULL="',
    ...compositionLines,
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
