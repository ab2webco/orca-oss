import type {
  ClaudeTerminalAccountReport,
  ClaudeTerminalAccountUnknownReason
} from '../shared/managed-account-types'
import type { ClaudeTerminalAccountSwitchFailureReason } from '../shared/claude-terminal-account-switch'
import { formatVaultSettingsInheritance } from './account-settings-inheritance-format'
import type { ClaudeAccountAuthVerdict } from '../shared/claude-account-auth-verdict'
import type { RateLimitWindow } from '../shared/rate-limit-types'
import {
  accountListEntriesOf,
  type AccountListEntry,
  type AccountQuota,
  type RuntimeAccountsSnapshot
} from '../shared/managed-account-list-entries'

export {
  accountListEntriesOf,
  type AccountListEntry,
  type AccountQuota,
  type RuntimeAccountsSnapshot
} from '../shared/managed-account-list-entries'

export type AccountListReport = {
  accounts: AccountListEntry[]
  /** Which account the pane runs on. `active` is the GLOBAL selection and never
   *  answers that question — reading it there is the ORCA-175 defect. */
  terminal: ClaudeTerminalAccountReport
}

export function buildAccountListReport(
  snapshot: RuntimeAccountsSnapshot,
  terminal: ClaudeTerminalAccountReport
): AccountListReport {
  return { accounts: accountListEntriesOf(snapshot), terminal }
}

function formatWindow(label: string, window: RateLimitWindow | null | undefined): string | null {
  if (!window) {
    return null
  }
  const reset = window.resetDescription ? ` (resets ${window.resetDescription})` : ''
  return `${label} ${Math.round(window.usedPercent)}%${reset}`
}

function formatQuota(quota: AccountQuota | null): string {
  if (!quota) {
    return 'quota: unavailable'
  }
  const windows = [
    formatWindow('session', quota.session),
    formatWindow('weekly', quota.weekly),
    formatWindow('fable-weekly', quota.fableWeekly),
    formatWindow('monthly', quota.monthly)
  ].filter((entry): entry is string => entry !== null)
  if (windows.length === 0) {
    return quota.error ? `quota: ${quota.status} (${quota.error})` : `quota: ${quota.status}`
  }
  return windows.join(' · ')
}

export const UNKNOWN_TERMINAL_ACCOUNT_REASONS: Record<ClaudeTerminalAccountUnknownReason, string> =
  {
    'pane-unresolved': 'no live pane resolved for that handle (closed, asleep, or reminted)',
    'no-claude-binding': 'Orca Lab holds no Claude account binding for this pane',
    'ownership-unresolved': 'this pane outlived a restart and its owner is not resolved yet',
    'remote-host': 'this pane runs on a WSL distro or SSH host that owns its own Claude auth',
    'no-caller-terminal':
      'this command is not running inside an Orca Lab-managed terminal; pass --terminal <handle>',
    'lookup-failed': 'the runtime could not answer (it may be older than this CLI)'
  }

const UNSWITCHABLE_TERMINAL_REASONS: Partial<
  Record<ClaudeTerminalAccountSwitchFailureReason, string>
> = {
  'missing-launch-config': 'Orca Lab no longer holds the command this pane was launched with',
  'missing-session': 'no Claude session has been observed in this pane yet',
  'source-unknown': 'no managed Claude account is bound to this pane',
  'workspace-unresolved': 'Orca Lab could not resolve a working directory for this pane',
  'transcript-unavailable':
    'this session has no saved conversation yet; send it a message first, then switch',
  'unsupported-runtime': 'this pane runs on a WSL distro or SSH host that owns its own Claude auth',
  'terminal-not-found': 'no live pane resolved for that handle',
  'runtime-unavailable': 'this runtime came up without account services attached'
}

// Why this is reported unasked: until ORCA-187 the only signal that a pane could
// not be switched was the switch failing, and a pane that outlived a restart is
// the common way to get there.
function formatSwitchReadiness(report: ClaudeTerminalAccountReport): string {
  const readiness = report.switchReadiness
  if (!readiness || readiness.state === 'ready') {
    return ''
  }
  const explanation = UNSWITCHABLE_TERMINAL_REASONS[readiness.reason]
  return `\nnot switchable: ${explanation ?? 'the switch would be refused'} (${readiness.reason})`
}

// Why this leads the output: `active` is the global selection, and reading it as
// the answer to "which account is this terminal on" is the defect (ORCA-175).
function formatTerminalAccount(report: ClaudeTerminalAccountReport): string {
  const pane = report.terminal ? ` [${report.terminal}]` : ''
  const caution = '(`active` below is the global selection, not this terminal’s account.)'
  const switchable = formatSwitchReadiness(report)
  const settings = formatVaultSettingsInheritance(report.settingsInheritance)
  const { ownership } = report
  if (ownership.state === 'account') {
    const label = ownership.email ?? `id ${ownership.accountId}`
    const binding = ownership.pinned ? 'pinned to this pane' : "Orca Lab's shared runtime auth"
    return `this terminal: ${label}  id ${ownership.accountId}  (${binding})${pane}${switchable}${settings}\n${caution}`
  }
  if (ownership.state === 'none') {
    return `this terminal: no managed Claude account — it runs on the login in Orca Lab's shared runtime${pane}${switchable}${settings}\n${caution}`
  }
  return `this terminal: unknown — ${UNKNOWN_TERMINAL_ACCOUNT_REASONS[ownership.reason]} (${ownership.reason})${pane}${switchable}${settings}\n${caution}`
}

function formatAuthVerdict(verdict: ClaudeAccountAuthVerdict | null): string {
  if (!verdict || verdict.state === 'unverified') {
    return 'auth: not checked'
  }
  const undecided = verdict.undecided ? `last check undecided: ${verdict.undecided}` : null
  if (verdict.state === 'failed') {
    const failure =
      verdict.failure === 'no-credentials' ? 'no stored credential' : 'credential rejected'
    return `auth: FAILED (${[failure, undecided].filter(Boolean).join(', ')})`
  }
  return undecided ? `auth: verified (${undecided})` : 'auth: verified'
}

export function formatAccountList(report: AccountListReport): string {
  const terminal = formatTerminalAccount(report.terminal)
  if (report.accounts.length === 0) {
    return `${terminal}\n\nNo managed accounts.`
  }
  const paneAccountId =
    report.terminal.ownership.state === 'account' ? report.terminal.ownership.accountId : null
  const accounts = report.accounts
    .map((entry) => {
      const kind = entry.authMethod === 'custom-endpoint' ? ' custom-endpoint' : ''
      const endpoint = entry.endpointLabel ? ` [${entry.endpointLabel}]` : ''
      const wsl = entry.runtime === 'wsl' ? ` wsl:${entry.wslDistro ?? 'default'}` : ''
      const active = entry.active ? '  active' : ''
      const pane =
        entry.provider === 'claude' && entry.id === paneAccountId ? '  <- this terminal' : ''
      const auth = entry.provider === 'claude' ? `  ${formatAuthVerdict(entry.auth ?? null)}` : ''
      return `${entry.provider}  ${entry.email}${endpoint}${kind}${wsl}  id ${entry.id}${active}${pane}\n  ${formatQuota(entry.quota)}${auth}`
    })
    .join('\n')
  return `${terminal}\n\n${accounts}`
}
