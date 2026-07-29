import {
  normalizeClaudeStatusLineItemOrder,
  normalizeClaudeStatusLineItems,
  type ClaudeStatusLineItemKey,
  type ClaudeStatusLineItems
} from '../../shared/claude-statusline-items'
import { STATUSLINE_MAX_WIDTH } from '../../shared/claude-statusline-line-model'
import {
  percentGuardLines,
  posixAccountLines,
  posixContextLines,
  posixCostLines,
  posixModelLines,
  posixProjectLines
} from './statusline-posix-fields'
import { getWindowsManagedStatusLineScript } from './statusline-script-windows'
import {
  deriveStatusLineBarCells,
  posixContextTrendLines,
  posixGaugeFunctionLines,
  posixResetCountdownLines,
  STATUSLINE_RESET_MARK_UNICODE
} from './statusline-usage-gauge'
import {
  CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS,
  CLAUDE_STATUSLINE_PATHNAME
} from '../../shared/claude-statusline-rate-limits'

// Why a module-level source instead of threading the store through every install path: the
// script is written from boot install, vault pinning, and the Settings toggle alike, and all of
// them must agree on the persisted choice without each carrying a Store reference.
type ClaudeStatusLineItemsSource = () => Partial<ClaudeStatusLineItems> | undefined
let claudeStatusLineItemsSource: ClaudeStatusLineItemsSource = () => undefined

export function configureClaudeStatusLineItemsSource(source: ClaudeStatusLineItemsSource): void {
  claudeStatusLineItemsSource = source
}

type ClaudeStatusLineItemOrderSource = () => readonly ClaudeStatusLineItemKey[] | undefined
let claudeStatusLineItemOrderSource: ClaudeStatusLineItemOrderSource = () => undefined

export function configureClaudeStatusLineItemOrderSource(
  source: ClaudeStatusLineItemOrderSource
): void {
  claudeStatusLineItemOrderSource = source
}

// Why: Claude Code pipes `rate_limits` to the statusLine command on every turn; forwarding
// it gives Orca live usage without spending the OAuth usage endpoint's tight budget.
// stdout IS the user's status line, so every invocation prints model + context usage
// before any guard — only the POST is debounced; a debounced print would blank the line.
export function getManagedStatusLineScript(
  target: 'local' | 'posix' = 'local',
  items?: Partial<ClaudeStatusLineItems>,
  order?: readonly ClaudeStatusLineItemKey[]
): string {
  const resolved = normalizeClaudeStatusLineItems(items ?? claudeStatusLineItemsSource())
  const resolvedOrder = normalizeClaudeStatusLineItemOrder(
    order ?? claudeStatusLineItemOrderSource()
  )
  if (target === 'local' && process.platform === 'win32') {
    return getWindowsManagedStatusLineScript(resolved, resolvedOrder)
  }
  const cells = deriveStatusLineBarCells(resolved)
  const anyQuota = resolved.fiveHourQuota || resolved.sevenDayQuota
  const anyBar = resolved.context || anyQuota

  // The composition block for each item, emitted in the configured order. Identity fields
  // (project, model, context) use the unconditional `append`; budgeted fields use `try`, so
  // their configured order is also the order they fall in when columns run out.
  const composeBlocks: Record<ClaudeStatusLineItemKey, readonly string[]> = {
    project: ['orca_statusline_append "$orca_statusline_project" "$orca_statusline_project_w"'],
    model: ['orca_statusline_append "$orca_statusline_model" "${#orca_statusline_model}"'],
    // Why no word for "used": the bar fills as consumption grows, which says it in every language —
    // this script never reaches translate(), so an English label would clash with a Spanish UI.
    context: [
      'if [ -n "$orca_statusline_context" ]; then',
      '  orca_statusline_ctx_field="ctx ${orca_statusline_ctx_bar:+$orca_statusline_ctx_bar }${orca_statusline_context}%${orca_statusline_trend:+ $orca_statusline_trend}"',
      '  orca_statusline_ctx_w=$(( ${#orca_statusline_context} + 5 ))',
      `  if [ -n "$orca_statusline_ctx_bar" ]; then orca_statusline_ctx_w=$(( orca_statusline_ctx_w + ${cells + 1} )); fi`,
      '  if [ -n "$orca_statusline_trend" ]; then orca_statusline_ctx_w=$(( orca_statusline_ctx_w + 2 )); fi',
      '  orca_statusline_append "$orca_statusline_ctx_field" "$orca_statusline_ctx_w"',
      'fi'
    ],
    account: [
      'orca_statusline_try "$orca_statusline_account" "@$orca_statusline_account" \\',
      '  $(( orca_statusline_account_w + 1 ))'
    ],
    fiveHourQuota: [
      'orca_statusline_try "$orca_statusline_five" \\',
      '  "5h ${orca_statusline_five_bar:+$orca_statusline_five_bar }${orca_statusline_five}%" \\',
      `  $(( \${#orca_statusline_five} + ${cells + 5} ))`
    ],
    sevenDayQuota: [
      'orca_statusline_try "$orca_statusline_seven" \\',
      '  "7d ${orca_statusline_seven_bar:+$orca_statusline_seven_bar }${orca_statusline_seven}%" \\',
      `  $(( \${#orca_statusline_seven} + ${cells + 5} ))`
    ],
    cost: [
      // Why the cost is ASCII by construction: its byte length is its column width.
      'orca_statusline_try "$orca_statusline_cost" "$orca_statusline_cost" "${#orca_statusline_cost}"'
    ],
    resetCountdown: [
      'orca_statusline_try "$orca_statusline_reset" \\',
      `  "${STATUSLINE_RESET_MARK_UNICODE} $orca_statusline_reset" \\`,
      '  $(( ${#orca_statusline_reset} + 2 ))'
    ]
  }

  return [
    '#!/bin/sh',
    // Why: this runs on every statusline tick; builtin capture avoids replacing curl churn with cat churn.
    'payload=',
    'while IFS= read -r orca_statusline_line || [ -n "$orca_statusline_line" ]; do',
    '  payload="${payload}${orca_statusline_line}\n"',
    'done',
    'payload=${payload%?}',
    'if [ -z "$payload" ]; then',
    '  exit 0',
    'fi',
    ...(resolved.model ? posixModelLines() : []),
    ...(resolved.context ? posixContextLines() : []),
    ...(resolved.project ? posixProjectLines() : []),
    ...(resolved.cost ? posixCostLines() : []),
    // Why bound each window at its own first `}`: five_hour and seven_day both carry
    // used_percentage, so truncating by sibling key name would break on any key reorder.
    ...(anyQuota
      ? [
          'orca_statusline_five=',
          'orca_statusline_seven=',
          'case "$payload" in',
          '  *\'"rate_limits"\'*)',
          '    orca_statusline_limits=${payload#*\'"rate_limits"\'}',
          '    for orca_statusline_window in five_hour seven_day; do',
          '      orca_statusline_pct=',
          '      case "$orca_statusline_limits" in',
          '        *"\\"${orca_statusline_window}\\""*)',
          '          orca_statusline_pct=${orca_statusline_limits#*"\\"${orca_statusline_window}\\""}',
          '          orca_statusline_pct=${orca_statusline_pct%%\\}*}',
          '          case "$orca_statusline_pct" in',
          '            *\'"used_percentage"\'*)',
          '              orca_statusline_pct=${orca_statusline_pct#*\'"used_percentage"\'}',
          '              orca_statusline_pct=${orca_statusline_pct#*:}',
          '              orca_statusline_pct=${orca_statusline_pct#"${orca_statusline_pct%%[![:space:]]*}"}',
          '              orca_statusline_pct=${orca_statusline_pct%%[!0-9]*}',
          '              ;;',
          '            *) orca_statusline_pct= ;;',
          '          esac',
          '          ;;',
          '      esac',
          '      case "$orca_statusline_window" in',
          '        five_hour) orca_statusline_five=$orca_statusline_pct ;;',
          '        *) orca_statusline_seven=$orca_statusline_pct ;;',
          '      esac',
          '    done',
          '    ;;',
          'esac',
          ...percentGuardLines('orca_statusline_five'),
          ...percentGuardLines('orca_statusline_seven')
        ]
      : []),
    // Why key the account cache on the config dir's own directory name: it is the account id,
    // so a repinned worktree can never render the previous account's label from a stale cache.
    // The key derivation always runs — the intro marker and the reset countdown reuse it even
    // when the account item itself is turned off.
    'orca_statusline_account=',
    'orca_statusline_acct_key=',
    'if [ -n "$CLAUDE_CONFIG_DIR" ]; then',
    '  orca_statusline_acct_key=${CLAUDE_CONFIG_DIR%/}',
    '  orca_statusline_acct_key=${orca_statusline_acct_key%/auth}',
    '  orca_statusline_acct_key=${orca_statusline_acct_key##*/}',
    '  case "$orca_statusline_acct_key" in',
    "    ''|*[!A-Za-z0-9._-]*) orca_statusline_acct_key= ;;",
    '  esac',
    'fi',
    ...(resolved.account ? posixAccountLines() : []),
    // Why announce once per pane: the line is requested ~3x/sec, so a banner on every tick would
    // strobe. Separate stamp from the POST throttle — that one governs the network, not the render.
    'orca_statusline_intro=',
    'orca_statusline_intro_key=${ORCA_PANE_KEY:-$orca_statusline_acct_key}',
    'orca_statusline_intro_key=${orca_statusline_intro_key##*:}',
    'case "$orca_statusline_intro_key" in',
    "  ''|*[!A-Za-z0-9._-]*) orca_statusline_intro_key= ;;",
    'esac',
    'if [ -n "$orca_statusline_intro_key" ]; then',
    '  orca_statusline_intro_stamp="${TMPDIR:-/tmp}/orca-claude-statusline-intro-${orca_statusline_intro_key}"',
    '  if [ ! -f "$orca_statusline_intro_stamp" ]; then',
    "    orca_statusline_intro='Orca by Ab2Web'",
    '    : >"$orca_statusline_intro_stamp" 2>/dev/null || :',
    '  fi',
    'fi',
    ...(resolved.context ? posixContextTrendLines() : []),
    ...(resolved.resetCountdown ? posixResetCountdownLines() : []),
    ...(anyBar ? posixGaugeFunctionLines(cells) : []),
    // Why columns are counted and never measured: a bar cell and the `·` separator are multi-byte,
    // and `${#}` counts bytes under dash — measuring would charge 32 phantom columns for three
    // bars and drop quota that actually fits. Every part's width is known at build time instead.
    'orca_statusline_append() {',
    '  if [ -z "$1" ]; then return 0; fi',
    '  if [ -n "$orca_statusline_line" ]; then',
    '    orca_statusline_line="$orca_statusline_line · "',
    '    orca_statusline_width=$(( orca_statusline_width + 3 ))',
    '  fi',
    '  orca_statusline_line="$orca_statusline_line$1"',
    '  orca_statusline_width=$(( orca_statusline_width + $2 ))',
    '}',
    // Why a sticky "full" flag rather than skipping: admitting a shorter field behind one that did
    // not fit inverts the priority order the ladder exists to express.
    'orca_statusline_try() {',
    '  if [ -n "$orca_statusline_full" ] || [ -z "$1" ]; then return 0; fi',
    '  orca_statusline_next=$(( orca_statusline_width + $3 ))',
    '  if [ -n "$orca_statusline_line" ]; then',
    '    orca_statusline_next=$(( orca_statusline_next + 3 ))',
    '  fi',
    `  if [ "$orca_statusline_next" -gt ${STATUSLINE_MAX_WIDTH} ]; then`,
    '    orca_statusline_full=1',
    '    return 0',
    '  fi',
    '  orca_statusline_append "$2" "$3"',
    '}',
    ...(resolved.context
      ? [
          'orca_statusline_gauge "$orca_statusline_context"',
          'orca_statusline_ctx_bar=$orca_statusline_gauge_out'
        ]
      : []),
    ...(resolved.fiveHourQuota
      ? [
          'orca_statusline_gauge "$orca_statusline_five"',
          'orca_statusline_five_bar=$orca_statusline_gauge_out'
        ]
      : []),
    ...(resolved.sevenDayQuota
      ? [
          'orca_statusline_gauge "$orca_statusline_seven"',
          'orca_statusline_seven_bar=$orca_statusline_gauge_out'
        ]
      : []),
    'orca_statusline_line=',
    'orca_statusline_width=0',
    'orca_statusline_full=',
    // Why identity fields (project, model, context) always append: all are short and bounded, so
    // dropping them buys almost no width while costing the things the line exists to say — and
    // the project never falling is the point: in a narrow pane it was the first thing the old
    // cascade hid, and it is what the user most misses. Budgeted fields fall in configured
    // order: by default the account truncates before it disappears, then the session quota,
    // then the weekly one, then the cost, then the countdown.
    'orca_statusline_append "$orca_statusline_intro" "${#orca_statusline_intro}"',
    ...resolvedOrder.flatMap((key) => (resolved[key] ? composeBlocks[key] : [])),
    'if [ -n "$orca_statusline_line" ]; then',
    '  printf \'%s\\n\' "$orca_statusline_line"',
    'fi',
    // Why: rate_limits appears only for Claude.ai-subscriber sessions after the first API response; skip the post (and its curl spawn) otherwise.
    'case "$payload" in',
    '  *\'"rate_limits"\'*) ;;',
    '  *) exit 0 ;;',
    'esac',
    'if [ -n "$ORCA_AGENT_HOOK_ENDPOINT" ] && [ -r "$ORCA_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$ORCA_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$ORCA_AGENT_HOOK_PORT" ] || [ -z "$ORCA_AGENT_HOOK_TOKEN" ] || [ -z "$ORCA_PANE_KEY" ]; then',
    '  exit 0',
    'fi',
    // Why: the stable leaf UUID avoids path-unsafe and overlong user-supplied tab ids.
    'orca_statusline_pane_id=${ORCA_PANE_KEY##*:}',
    // Why: pre-migration numeric leaf ids were tab-local, so include a safe tab id to avoid cross-pane throttle collisions after upgrade.
    'case "$orca_statusline_pane_id" in',
    "  ''|*[!0-9]*) ;;",
    '  *)',
    '    orca_statusline_tab_id=${ORCA_PANE_KEY%:*}',
    '    case "$orca_statusline_tab_id" in',
    "      ''|*[!A-Za-z0-9._-]*) ;;",
    '      *) orca_statusline_pane_id="${orca_statusline_tab_id}_${orca_statusline_pane_id}" ;;',
    '    esac',
    '    ;;',
    'esac',
    'orca_statusline_stamp="${TMPDIR:-/tmp}/orca-claude-statusline-last-${orca_statusline_pane_id}"',
    // Why: the payload clock keeps throttled ticks free of subprocesses; date is only a schema-drift fallback.
    'orca_statusline_now=',
    'case "$payload" in',
    '  *\'"total_duration_ms"\'*)',
    '    orca_statusline_duration=${payload#*\'"total_duration_ms"\'}',
    '    orca_statusline_duration=${orca_statusline_duration#*:}',
    '    orca_statusline_duration=${orca_statusline_duration#"${orca_statusline_duration%%[![:space:]]*}"}',
    '    orca_statusline_duration=${orca_statusline_duration%%[!0-9]*}',
    '    case "$orca_statusline_duration" in',
    '      0|[1-9]|[1-9][0-9]*)',
    '        if [ "${#orca_statusline_duration}" -le 15 ]; then',
    '          orca_statusline_now=$((orca_statusline_duration / 1000))',
    '        fi',
    '        ;;',
    '    esac',
    '    ;;',
    'esac',
    'if [ -z "$orca_statusline_now" ]; then',
    '  orca_statusline_now=$(date +%s 2>/dev/null) || orca_statusline_now=',
    'fi',
    // Why: leading zeros read as octal inside $(( )), and a bad constant (008) is FATAL in dash —
    // the script would die before rewriting the stamp, wedging the pane dark. Allow-list canonical
    // decimals so any malformed value fails open to posting instead.
    'case "$orca_statusline_now" in 0|[1-9]|[1-9][0-9]*) ;; *) orca_statusline_now= ;; esac',
    'if [ -n "$orca_statusline_now" ] && [ -f "$orca_statusline_stamp" ]; then',
    '  orca_statusline_last=',
    '  IFS= read -r orca_statusline_last <"$orca_statusline_stamp" 2>/dev/null || :',
    '  case "$orca_statusline_last" in 0|[1-9]|[1-9][0-9]*) ;; *) orca_statusline_last= ;; esac',
    '  if [ "${#orca_statusline_last}" -gt 15 ]; then orca_statusline_last=; fi',
    '  if [ -n "$orca_statusline_last" ]; then',
    '    orca_statusline_elapsed=$((orca_statusline_now - orca_statusline_last))',
    `    if [ "$orca_statusline_elapsed" -ge 0 ] && [ "$orca_statusline_elapsed" -lt ${CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS} ]; then`,
    '      exit 0',
    '    fi',
    '  fi',
    'fi',
    'if [ -n "$orca_statusline_now" ]; then',
    '  printf \'%s\' "$orca_statusline_now" >"$orca_statusline_stamp" 2>/dev/null || :',
    'fi',
    `printf '%s' "$payload" | curl -sS -X POST "http://127.0.0.1:\${ORCA_AGENT_HOOK_PORT}${CLAUDE_STATUSLINE_PATHNAME}" \\`,
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Orca-Agent-Hook-Token: ${ORCA_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${ORCA_PANE_KEY}" \\',
    '  --data-urlencode "configDir=${CLAUDE_CONFIG_DIR}" \\',
    '  --data-urlencode "env=${ORCA_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${ORCA_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || true',
    'exit 0',
    ''
  ].join('\n')
}
