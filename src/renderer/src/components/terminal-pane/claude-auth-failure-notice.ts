import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

export type ClaudeAuthFailurePaneAccount =
  | { kind: 'account'; accountId: string; email: string }
  | { kind: 'reauthenticated-since'; accountId: string; email: string }
  | { kind: 'shared' }
  | { kind: 'unknown' }

export function describeClaudeAuthFailure(account: ClaudeAuthFailurePaneAccount): string {
  if (account.kind === 'account') {
    return translate(
      'auto.components.terminal-pane.claudeAuthFailure.account',
      'Claude sign-in expired for {{value0}}. Re-authenticate that account in Settings → Claude.',
      { value0: account.email }
    )
  }
  if (account.kind === 'reauthenticated-since') {
    return translate(
      'auto.components.terminal-pane.claudeAuthFailure.reauthenticatedSince',
      'This pane still holds an expired Claude sign-in, but {{value0}} was re-authenticated after this pane started. Restart the pane to pick up the new sign-in.',
      { value0: account.email }
    )
  }
  if (account.kind === 'shared') {
    return translate(
      'auto.components.terminal-pane.claudeAuthFailure.shared',
      'Claude sign-in expired for this pane, which runs on the shared Claude login (no managed account pinned).'
    )
  }
  return translate(
    'auto.components.terminal-pane.claudeAuthFailure.unknown',
    'Claude sign-in expired in this pane. Orca could not tell which account it runs on.'
  )
}

export async function resolveClaudeAuthFailurePaneAccount(
  ptyId: string,
  observedSince: number
): Promise<ClaudeAuthFailurePaneAccount> {
  try {
    const info = await window.api.claudeAccounts.getLivePtyAccount({ ptyId })
    if (!info) {
      return { kind: 'unknown' }
    }
    if (!info.accountId) {
      return info.injected ? { kind: 'unknown' } : { kind: 'shared' }
    }
    const managed = useAppStore
      .getState()
      .settings?.claudeManagedAccounts.find((account) => account.id === info.accountId)
    if (!managed?.email) {
      return { kind: 'unknown' }
    }
    // Why: the CLI in this pane keeps redrawing its banner over the credential it
    // launched with, so a rejection older than the reissue would fail an account
    // that now works — the ticket's lie, inverted.
    const kind = managed.lastAuthenticatedAt > observedSince ? 'reauthenticated-since' : 'account'
    return { kind, accountId: info.accountId, email: managed.email }
  } catch {
    return { kind: 'unknown' }
  }
}

export async function notifyClaudeAuthFailure(ptyId: string, observedSince: number): Promise<void> {
  const account = await resolveClaudeAuthFailurePaneAccount(ptyId, observedSince)
  if (account.kind === 'account') {
    try {
      await window.api.rateLimits.recordClaudeCredentialRejection(account.accountId)
    } catch {
      // The pane failure remains actionable even if main is already disconnecting.
    }
  }
  toast.error(describeClaudeAuthFailure(account), { duration: 15_000 })
}
