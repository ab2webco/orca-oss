import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

export type ClaudeAuthFailurePaneAccount =
  | { kind: 'account'; email: string }
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
  ptyId: string
): Promise<ClaudeAuthFailurePaneAccount> {
  try {
    const info = await window.api.claudeAccounts.getLivePtyAccount({ ptyId })
    if (!info) {
      return { kind: 'unknown' }
    }
    if (!info.accountId) {
      return info.injected ? { kind: 'unknown' } : { kind: 'shared' }
    }
    const email = useAppStore
      .getState()
      .settings?.claudeManagedAccounts.find((account) => account.id === info.accountId)?.email
    return email ? { kind: 'account', email } : { kind: 'unknown' }
  } catch {
    return { kind: 'unknown' }
  }
}

export async function notifyClaudeAuthFailure(ptyId: string): Promise<void> {
  const account = await resolveClaudeAuthFailurePaneAccount(ptyId)
  toast.error(describeClaudeAuthFailure(account), { duration: 15_000 })
}
