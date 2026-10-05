import React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { INHERIT_GLOBAL_CLAUDE_ACCOUNT_VALUE } from '@/lib/claude-account-runtime-filter'
import { INHERIT_GLOBAL_CODEX_ACCOUNT_VALUE } from '@/lib/codex-account-runtime-filter'
import { translate } from '@/i18n/i18n'
import { parseExecutionHostId, getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import { Field } from './automation-page-parts'
import type { AutomationDraft } from './AutomationEditorDialog'
import {
  useAutomationAccountRoster,
  type AutomationAccountProvider
} from './use-automation-account-roster'

type AutomationAccountFieldProps = {
  draft: AutomationDraft
  repo: Repo | null
  triggerClassName: string
  onDraftChange: (updater: (current: AutomationDraft) => AutomationDraft) => void
}

const REMOVED_ACCOUNT_VALUE = '__removed-account__'

type AccountTarget = { offered: false } | { offered: true; environmentId: string | null }

function resolveAccountTarget(repo: Repo | null): AccountTarget {
  if (!repo) {
    return { offered: false }
  }
  const host = parseExecutionHostId(getRepoExecutionHostId(repo))
  if (host?.kind === 'local') {
    return { offered: true, environmentId: null }
  }
  // SSH repos never get a managed account: pty skips injection when connectionId is set.
  return host?.kind === 'runtime'
    ? { offered: true, environmentId: host.environmentId }
    : { offered: false }
}

export function AutomationAccountField({
  draft,
  repo,
  triggerClassName,
  onDraftChange
}: AutomationAccountFieldProps): React.JSX.Element | null {
  const provider: AutomationAccountProvider | null =
    draft.actionKind === 'command'
      ? null
      : draft.agentId === 'claude' || draft.agentId === 'codex'
        ? draft.agentId
        : null
  const target = resolveAccountTarget(repo)
  const offered = provider !== null && target.offered
  const roster = useAutomationAccountRoster(
    provider ?? 'claude',
    target.offered ? target.environmentId : null,
    repo?.path ?? '',
    offered
  )
  if (!offered || provider === null) {
    return null
  }

  const inheritValue =
    provider === 'claude' ? INHERIT_GLOBAL_CLAUDE_ACCOUNT_VALUE : INHERIT_GLOBAL_CODEX_ACCOUNT_VALUE
  const selectedId = provider === 'claude' ? draft.claudeAccountId : draft.codexAccountId
  const isRemoved =
    selectedId !== null &&
    roster.status === 'ready' &&
    !roster.accounts.some((account) => account.id === selectedId)
  const label =
    provider === 'claude'
      ? translate(
          'auto.components.automations.AutomationAccountField.claudeLabel',
          'Claude account'
        )
      : translate('auto.components.automations.AutomationAccountField.codexLabel', 'Codex account')
  const onChange = (value: string): void => {
    const next = value === inheritValue ? null : value
    onDraftChange((current) =>
      provider === 'claude'
        ? { ...current, claudeAccountId: next }
        : { ...current, codexAccountId: next }
    )
  }

  return (
    <Field label={label}>
      <Select
        value={isRemoved ? REMOVED_ACCOUNT_VALUE : (selectedId ?? inheritValue)}
        onValueChange={onChange}
        disabled={!roster.hostSupportsPin}
      >
        <SelectTrigger
          aria-label={label}
          className={`h-9 w-full min-w-0 text-sm ${triggerClassName}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={inheritValue}>
            {translate(
              'auto.components.automations.AutomationAccountField.inherit',
              'Inherit (worktree or global)'
            )}
          </SelectItem>
          {roster.accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {account.email}
            </SelectItem>
          ))}
          {isRemoved ? (
            <SelectItem value={REMOVED_ACCOUNT_VALUE} disabled>
              {translate(
                'auto.components.automations.AutomationAccountField.removed',
                'Removed account'
              )}
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      {!roster.hostSupportsPin ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.automations.AutomationAccountField.hostUnsupported',
            'Update the host to pick an account for automations.'
          )}
        </p>
      ) : isRemoved ? (
        <p className="text-xs text-destructive">
          {translate(
            'auto.components.automations.AutomationAccountField.removedWarning',
            'The saved account is no longer available. Pick another or inherit.'
          )}
        </p>
      ) : null}
    </Field>
  )
}
