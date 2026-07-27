import { getWindowsManagedStatusLineScript } from './statusline-script-windows'
import { posixContextTrendLines, posixGaugeFunctionLines } from './statusline-usage-gauge'
import {
  CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS,
  CLAUDE_STATUSLINE_PATHNAME
} from '../../shared/claude-statusline-rate-limits'

// Why 96: a status line that wraps reads as a broken app, and the width has to be assumed because
// reading the real terminal width needs a subprocess on a path that runs ~3x/sec.
const STATUSLINE_MAX_WIDTH = 96

// Why a canonical-decimal allow-list rather than a digits test: a leading-zero value is invalid
// octal inside `$(( ))` and is FATAL in dash, so the trend arithmetic below would kill the script
// before it printed anything. Anything unexpected renders as absent, never as a false 0%.
function percentGuardLines(variable: string): readonly string[] {
  return [
    `case "$${variable}" in 0|[1-9]|[1-9][0-9]*) ;; *) ${variable}= ;; esac`,
    `if [ "\${#${variable}}" -gt 3 ]; then ${variable}=; fi`
  ]
}

// Why: Claude Code pipes `rate_limits` to the statusLine command on every turn; forwarding
// it gives Orca live usage without spending the OAuth usage endpoint's tight budget.
// stdout IS the user's status line, so every invocation prints model + context usage
// before any guard — only the POST is debounced; a debounced print would blank the line.
export function getManagedStatusLineScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return getWindowsManagedStatusLineScript()
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
    // Why: print before every exit path — most ticks carry no rate_limits and throttled ticks
    // exit early, so a print anywhere later would flicker. Builtins only: this runs ~3x/sec.
    'orca_statusline_model=',
    'case "$payload" in',
    '  *\'"display_name"\'*)',
    '    orca_statusline_model=${payload#*\'"display_name"\'}',
    "    orca_statusline_model=${orca_statusline_model#*'\"'}",
    "    orca_statusline_model=${orca_statusline_model%%'\"'*}",
    '    ;;',
    'esac',
    // Why: mirror parseModelLabel's display_name → model.id fallback so older CLIs still label the line.
    'if [ -z "$orca_statusline_model" ]; then',
    '  case "$payload" in',
    '    *\'"model"\'*)',
    '      orca_statusline_model=${payload#*\'"model"\'}',
    '      case "$orca_statusline_model" in',
    '        *\'"id"\'*)',
    '          orca_statusline_model=${orca_statusline_model#*\'"id"\'}',
    "          orca_statusline_model=${orca_statusline_model#*'\"'}",
    "          orca_statusline_model=${orca_statusline_model%%'\"'*}",
    '          ;;',
    '        *) orca_statusline_model= ;;',
    '      esac',
    '      ;;',
    '  esac',
    'fi',
    // Why: truncate at rate_limits so its used_percentage can never masquerade as context usage
    // when a CLI drift drops context_window's own field.
    'orca_statusline_context=',
    'case "$payload" in',
    '  *\'"context_window"\'*)',
    '    orca_statusline_context=${payload#*\'"context_window"\'}',
    '    orca_statusline_context=${orca_statusline_context%%\'"rate_limits"\'*}',
    '    case "$orca_statusline_context" in',
    '      *\'"used_percentage"\'*)',
    '        orca_statusline_context=${orca_statusline_context#*\'"used_percentage"\'}',
    '        orca_statusline_context=${orca_statusline_context#*:}',
    '        orca_statusline_context=${orca_statusline_context#"${orca_statusline_context%%[![:space:]]*}"}',
    '        orca_statusline_context=${orca_statusline_context%%[!0-9]*}',
    '        ;;',
    '      *) orca_statusline_context= ;;',
    '    esac',
    '    ;;',
    'esac',
    ...percentGuardLines('orca_statusline_context'),
    // Why bound each window at its own first `}`: five_hour and seven_day both carry
    // used_percentage, so truncating by sibling key name would break on any key reorder.
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
    ...percentGuardLines('orca_statusline_seven'),
    // Why key the account cache on the config dir's own directory name: it is the account id,
    // so a repinned worktree can never render the previous account's label from a stale cache.
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
    'if [ -n "$orca_statusline_acct_key" ]; then',
    '  orca_statusline_acct_cache="${TMPDIR:-/tmp}/orca-claude-statusline-acct-${orca_statusline_acct_key}"',
    '  if [ -r "$orca_statusline_acct_cache" ]; then',
    '    IFS= read -r orca_statusline_account <"$orca_statusline_acct_cache" 2>/dev/null || :',
    '  fi',
    // Why read the vault file at most once per account: this runs ~3x/sec, so the cache is what
    // keeps the account label free. A miss costs one small read, never a subprocess.
    '  if [ -z "$orca_statusline_account" ] && [ -r "${CLAUDE_CONFIG_DIR}/oauth-account.json" ]; then',
    '    orca_statusline_acct_raw=',
    '    while IFS= read -r orca_statusline_acct_chunk || [ -n "$orca_statusline_acct_chunk" ]; do',
    '      orca_statusline_acct_raw="${orca_statusline_acct_raw}${orca_statusline_acct_chunk}"',
    '    done <"${CLAUDE_CONFIG_DIR}/oauth-account.json"',
    '    case "$orca_statusline_acct_raw" in',
    '      *\'"emailAddress"\'*)',
    '        orca_statusline_account=${orca_statusline_acct_raw#*\'"emailAddress"\'}',
    "        orca_statusline_account=${orca_statusline_account#*'\"'}",
    "        orca_statusline_account=${orca_statusline_account%%'\"'*}",
    '        ;;',
    '      *) orca_statusline_account= ;;',
    '    esac',
    '    if [ -n "$orca_statusline_account" ]; then',
    '      printf \'%s\' "$orca_statusline_account" >"$orca_statusline_acct_cache" 2>/dev/null || :',
    '    fi',
    '  fi',
    'fi',
    // Why drop the domain: the local part is what distinguishes several accounts on one domain,
    // and the whole line has to survive a narrow pane.
    'case "$orca_statusline_account" in',
    '  *@*) orca_statusline_account="${orca_statusline_account%%@*}@" ;;',
    'esac',
    // Why bound the local part too: an unusually long address would otherwise be the one field
    // that can blow the whole line, and the ladder below would then drop quota to pay for it.
    // Why track the width separately from here on: `\u2026` is one column but three bytes, and
    // `${#}` counts bytes under dash \u2014 measuring the rendered string would over-charge the budget.
    'orca_statusline_account_w=${#orca_statusline_account}',
    'if [ "${#orca_statusline_account}" -gt 21 ]; then',
    '  orca_statusline_account="${orca_statusline_account%?}"',
    '  while [ "${#orca_statusline_account}" -gt 20 ]; do',
    '    orca_statusline_account=${orca_statusline_account%?}',
    '  done',
    '  orca_statusline_account="${orca_statusline_account}\u2026@"',
    '  orca_statusline_account_w=22',
    'fi',
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
    ...posixContextTrendLines(),
    ...posixGaugeFunctionLines(),
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
    'orca_statusline_gauge "$orca_statusline_context"',
    'orca_statusline_ctx_bar=$orca_statusline_gauge_out',
    'orca_statusline_gauge "$orca_statusline_five"',
    'orca_statusline_five_bar=$orca_statusline_gauge_out',
    'orca_statusline_gauge "$orca_statusline_seven"',
    'orca_statusline_seven_bar=$orca_statusline_gauge_out',
    'orca_statusline_line=',
    'orca_statusline_width=0',
    'orca_statusline_full=',
    // Why identity, model and context are the fixed prefix: all three are short and bounded, so
    // dropping them buys almost no width while costing the two things the line exists to say.
    'orca_statusline_append "$orca_statusline_intro" "${#orca_statusline_intro}"',
    'orca_statusline_append "$orca_statusline_model" "${#orca_statusline_model}"',
    // Why no word for "used": the bar fills as consumption grows, which says it in every language —
    // this script never reaches translate(), so an English label would clash with a Spanish UI.
    'if [ -n "$orca_statusline_context" ]; then',
    '  orca_statusline_ctx_field="ctx ${orca_statusline_ctx_bar:+$orca_statusline_ctx_bar }${orca_statusline_context}%${orca_statusline_trend:+ $orca_statusline_trend}"',
    '  orca_statusline_ctx_w=$(( ${#orca_statusline_context} + 5 ))',
    '  if [ -n "$orca_statusline_ctx_bar" ]; then orca_statusline_ctx_w=$(( orca_statusline_ctx_w + 6 )); fi',
    '  if [ -n "$orca_statusline_trend" ]; then orca_statusline_ctx_w=$(( orca_statusline_ctx_w + 2 )); fi',
    '  orca_statusline_append "$orca_statusline_ctx_field" "$orca_statusline_ctx_w"',
    'fi',
    // Priority order, and therefore the order these fall in: the account truncates before it
    // disappears, then the session quota, then the weekly one. Context never falls.
    'orca_statusline_try "$orca_statusline_account" "@$orca_statusline_account" \\',
    '  $(( orca_statusline_account_w + 1 ))',
    'orca_statusline_try "$orca_statusline_five" \\',
    '  "5h ${orca_statusline_five_bar:+$orca_statusline_five_bar }${orca_statusline_five}%" \\',
    '  $(( ${#orca_statusline_five} + 10 ))',
    'orca_statusline_try "$orca_statusline_seven" \\',
    '  "7d ${orca_statusline_seven_bar:+$orca_statusline_seven_bar }${orca_statusline_seven}%" \\',
    '  $(( ${#orca_statusline_seven} + 10 ))',
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
