/**
 * POSIX shell fragments that parse one statusline-payload field each, consumed by
 * `getManagedStatusLineScript`. Builtin-only by contract: these run ~3x/sec.
 */

import { STATUSLINE_PROJECT_MAX_COLUMNS } from '../../shared/claude-statusline-line-model'

// Why a canonical-decimal allow-list rather than a digits test: a leading-zero value is invalid
// octal inside `$(( ))` and is FATAL in dash, so the trend arithmetic would kill the script
// before it printed anything. Anything unexpected renders as absent, never as a false 0%.
export function percentGuardLines(variable: string): readonly string[] {
  return [
    `case "$${variable}" in 0|[1-9]|[1-9][0-9]*) ;; *) ${variable}= ;; esac`,
    `if [ "\${#${variable}}" -gt 3 ]; then ${variable}=; fi`
  ]
}

export function posixModelLines(): readonly string[] {
  return [
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
    'fi'
  ]
}

export function posixContextLines(): readonly string[] {
  return [
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
    ...percentGuardLines('orca_statusline_context')
  ]
}

// Why the directory name and not the full path: the basename is the project identity the owner
// asked to see, and a full path would eat the entire budget the quota bars need.
export function posixProjectLines(): readonly string[] {
  return [
    'orca_statusline_project=',
    'case "$payload" in',
    '  *\'"project_dir"\'*)',
    '    orca_statusline_project=${payload#*\'"project_dir"\'}',
    "    orca_statusline_project=${orca_statusline_project#*'\"'}",
    "    orca_statusline_project=${orca_statusline_project%%'\"'*}",
    '    orca_statusline_project=${orca_statusline_project%/}',
    '    orca_statusline_project=${orca_statusline_project##*/}',
    '    ;;',
    'esac',
    // Why the same byte-counted bound as the account: `…` is one column but three bytes, and a
    // multibyte name only truncates earlier, never wider.
    'orca_statusline_project_w=${#orca_statusline_project}',
    `if [ "\${#orca_statusline_project}" -gt ${STATUSLINE_PROJECT_MAX_COLUMNS} ]; then`,
    `  while [ "\${#orca_statusline_project}" -gt ${STATUSLINE_PROJECT_MAX_COLUMNS - 1} ]; do`,
    '    orca_statusline_project=${orca_statusline_project%?}',
    '  done',
    '  orca_statusline_project="${orca_statusline_project}…"',
    `  orca_statusline_project_w=${STATUSLINE_PROJECT_MAX_COLUMNS}`,
    'fi'
  ]
}

// The vault read, domain elision and bound for the account field. Assumes the acct-key
// derivation already ran — that part stays in the script because the intro marker and the
// reset countdown reuse the key even when the account item is off.
export function posixAccountLines(): readonly string[] {
  return [
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
    // Why drop the domain with no trailing @: the local part is what distinguishes several
    // accounts on one domain, and the rendered field's leading @ is already the account mark —
    // keeping the elision's @ too printed a double sigil (@user@) on every line.
    'case "$orca_statusline_account" in',
    '  *@*) orca_statusline_account=${orca_statusline_account%%@*} ;;',
    'esac',
    // Why bound the local part too: an unusually long address would otherwise be the one field
    // that can blow the whole line, and the ladder below would then drop quota to pay for it.
    // Why track the width separately from here on: `…` is one column but three bytes, and
    // `${#}` counts bytes under dash — measuring the rendered string would over-charge the budget.
    'orca_statusline_account_w=${#orca_statusline_account}',
    'if [ "${#orca_statusline_account}" -gt 21 ]; then',
    '  while [ "${#orca_statusline_account}" -gt 20 ]; do',
    '    orca_statusline_account=${orca_statusline_account%?}',
    '  done',
    '  orca_statusline_account="${orca_statusline_account}…"',
    '  orca_statusline_account_w=21',
    'fi'
  ]
}

// Why truncation and never arithmetic rounding: the value is informative, not billing-grade, and
// string slicing keeps the tick free of `$(( ))` on a float that dash cannot parse anyway.
export function posixCostLines(): readonly string[] {
  return [
    'orca_statusline_cost=',
    'case "$payload" in',
    '  *\'"total_cost_usd"\'*)',
    '    orca_statusline_cost=${payload#*\'"total_cost_usd"\'}',
    '    orca_statusline_cost=${orca_statusline_cost#*:}',
    '    orca_statusline_cost=${orca_statusline_cost#"${orca_statusline_cost%%[![:space:]]*}"}',
    '    ;;',
    'esac',
    'if [ -n "$orca_statusline_cost" ]; then',
    '  orca_statusline_cost_int=${orca_statusline_cost%%[!0-9]*}',
    '  orca_statusline_cost_rest=${orca_statusline_cost#"$orca_statusline_cost_int"}',
    '  orca_statusline_cost_dec=',
    '  case "$orca_statusline_cost_rest" in',
    '    .*)',
    '      orca_statusline_cost_dec=${orca_statusline_cost_rest#.}',
    '      orca_statusline_cost_dec=${orca_statusline_cost_dec%%[!0-9]*}',
    '      while [ "${#orca_statusline_cost_dec}" -gt 2 ]; do',
    '        orca_statusline_cost_dec=${orca_statusline_cost_dec%?}',
    '      done',
    '      ;;',
    // Why reject scientific notation outright: "5e-7" would otherwise render as $5.
    '    [eE]*) orca_statusline_cost_int= ;;',
    '  esac',
    '  case "$orca_statusline_cost_int" in 0|[1-9]|[1-9][0-9]*) ;; *) orca_statusline_cost_int= ;; esac',
    '  if [ "${#orca_statusline_cost_int}" -gt 4 ]; then orca_statusline_cost_int=; fi',
    '  if [ -z "$orca_statusline_cost_int" ]; then',
    '    orca_statusline_cost=',
    '  else',
    '    while [ -n "$orca_statusline_cost_dec" ] && [ "${#orca_statusline_cost_dec}" -lt 2 ]; do',
    '      orca_statusline_cost_dec="${orca_statusline_cost_dec}0"',
    '    done',
    '    orca_statusline_cost=\'$\'"$orca_statusline_cost_int${orca_statusline_cost_dec:+.$orca_statusline_cost_dec}"',
    '  fi',
    'fi'
  ]
}
