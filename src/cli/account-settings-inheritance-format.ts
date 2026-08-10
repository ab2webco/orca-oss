import type {
  ClaudeVaultSettingInheritance,
  ClaudeVaultSettingsInheritanceReport
} from '../shared/types'

// Why this is printed unasked, next to the account: until ORCA-189 a home setting
// that did not reach a managed vault produced no signal anywhere — the menu showed
// `Default ✔` and the no-attribution rule simply stopped applying. The whole point
// is that the failing case is legible without diffing two JSON files by hand.

const NOT_APPLICABLE_EXPLANATIONS: Record<
  Extract<ClaudeVaultSettingsInheritanceReport, { state: 'not-applicable' }>['reason'],
  string
> = {
  'shared-home': 'this terminal reads ~/.claude directly, so it already has every home setting',
  'remote-runtime': 'this terminal runs on a WSL distro or SSH host that owns its own ~/.claude',
  'unknown-account': 'no managed vault resolved for this terminal'
}

function formatProblem(entry: ClaudeVaultSettingInheritance): string | null {
  // Widened before the narrowing branches so an unrecognized state from a newer
  // runtime is still printable rather than typed away to `never`.
  const state: string = entry.state
  if (entry.state === 'stale') {
    return `${entry.key} stale (~/.claude changed after this session launched — relaunch to pick it up)`
  }
  if (entry.state === 'unresolved') {
    return `${entry.key} unresolved (defined at home, but this vault has no file behind it)`
  }
  // A state a newer runtime added: name it rather than dropping it silently.
  return state === 'inherited' || state === 'absent' ? null : `${entry.key} ${state}`
}

/**
 * One line naming what the pane's vault inherited from `~/.claude/settings.json`
 * and, explicitly, what it did not. Returns '' for runtimes older than ORCA-189,
 * which cannot answer — an absent block must never read as "nothing inherited".
 *
 * Says "this terminal's vault", not "this session": the state is the vault's
 * right now, and another pane on the same account may have re-merged it after
 * this one launched.
 */
export function formatVaultSettingsInheritance(
  report: ClaudeVaultSettingsInheritanceReport | undefined
): string {
  if (!report) {
    return ''
  }
  if (report.state !== 'vault') {
    // Fallback for a runtime that adds a reason this CLI does not know yet.
    const explanation = NOT_APPLICABLE_EXPLANATIONS[report.reason] ?? report.reason
    return `\nhome settings: not applicable — ${explanation}`
  }
  const entries = Array.isArray(report.keys) ? report.keys : []
  const inherited = entries.filter((entry) => entry.state === 'inherited').map((e) => e.key)
  const absent = entries.filter((entry) => entry.state === 'absent').map((e) => e.key)
  const problems = entries
    .map((entry) => formatProblem(entry))
    .filter((line): line is string => line !== null)
  const parts = [
    inherited.length > 0 ? `inherited ${inherited.join(', ')}` : 'inherited nothing',
    ...problems,
    absent.length > 0 ? `not set at home: ${absent.join(', ')}` : null
  ].filter((part): part is string => part !== null)
  return `\nhome settings in this terminal's vault: ${parts.join(' · ')}`
}
