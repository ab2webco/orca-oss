import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import { beginClaudeSetupToken } from '@/runtime/runtime-claude-setup-token-client'
import { ClaudeSetupTokenGenerate } from './ClaudeSetupTokenGenerate'

type ClaudeLongLivedTokenDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string | null
  accountLabel: string
  hasToken: boolean
  submitting: boolean
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  /** The host can run `claude setup-token` for this account. */
  canGenerate: boolean
  /** Pasting and removing go through the host-only RPC, so a paired client cannot. */
  canPaste: boolean
  onSave: (token: string) => void
  onClear: () => void
  onGenerated: (accounts: ClaudeRateLimitAccountsState) => void
  /** Added from a token alone: the token is its only sign-in, so it can be replaced, not removed. */
  tokenOnly?: boolean
}

export function ClaudeLongLivedTokenDialog({
  open,
  onOpenChange,
  accountId,
  accountLabel,
  hasToken,
  submitting,
  settings,
  canGenerate,
  canPaste,
  onSave,
  onClear,
  onGenerated,
  tokenOnly = false
}: ClaudeLongLivedTokenDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.ClaudeLongLivedTokenDialog.title',
              'Long-lived token'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.ClaudeLongLivedTokenDialog.generateDescription',
              'Orca Lab runs claude setup-token on the host that owns {{value0}} and stores the one-year token there. Agents on this account use it instead of the stored login, so they stop rotating it.',
              { value0: accountLabel }
            )}
          </DialogDescription>
        </DialogHeader>
        {canGenerate && accountId ? (
          <ClaudeSetupTokenGenerate
            settings={settings}
            begin={() => beginClaudeSetupToken(settings, accountId)}
            accountLabel={accountLabel}
            onStored={onGenerated}
          />
        ) : null}
        {/* Why: DialogContent unmounts on close, so a typed secret never survives into the next open. */}
        {canPaste ? (
          <PasteFallback
            collapsed={canGenerate}
            hasToken={hasToken}
            submitting={submitting}
            onSave={onSave}
          />
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.settings.ClaudeLongLivedTokenDialog.limitsHost',
            'The token only makes model requests: Remote Control and claude.ai connectors do not work with it. It never leaves the host that owns the account.'
          )}
        </p>
        {tokenOnly ? (
          <p className="text-[11px] text-muted-foreground">
            {translate(
              'auto.components.settings.ClaudeLongLivedTokenDialog.tokenOnlyNote',
              'This token is the account’s only sign-in, so it can be replaced but not removed. Remove the account to drop it.'
            )}
          </p>
        ) : null}
        {canPaste && hasToken && !tokenOnly ? (
          <DialogFooter>
            <Button variant="outline" onClick={onClear} disabled={submitting}>
              {translate(
                'auto.components.settings.ClaudeLongLivedTokenDialog.remove',
                'Remove token'
              )}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function PasteFallback({
  collapsed,
  hasToken,
  submitting,
  onSave
}: {
  collapsed: boolean
  hasToken: boolean
  submitting: boolean
  onSave: (token: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(!collapsed)
  const [draft, setDraft] = useState('')
  const canSave = draft.trim().length > 0 && !submitting

  if (!expanded) {
    return (
      <Button
        variant="link"
        size="xs"
        className="h-auto self-start px-0 text-muted-foreground"
        onClick={() => setExpanded(true)}
      >
        {translate(
          'auto.components.settings.ClaudeLongLivedTokenDialog.pasteInstead',
          'Paste a token instead'
        )}
      </Button>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="claude-long-lived-token">
        {translate('auto.components.settings.ClaudeLongLivedTokenDialog.inputLabel', 'Token')}
      </Label>
      <div className="flex gap-2">
        <Input
          id="claude-long-lived-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          // Why uncontrolled: React mirrors a controlled value into the `value` attribute, i.e. the DOM.
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            hasToken
              ? translate(
                  'auto.components.settings.ClaudeLongLivedTokenDialog.replacePlaceholder',
                  'A token is stored. Paste a new one to replace it.'
                )
              : undefined
          }
          className="min-w-0 text-xs"
        />
        <Button
          variant="outline"
          onClick={() => onSave(draft)}
          disabled={!canSave}
          className="gap-1.5"
        >
          {submitting ? <Loader2 className="size-3 animate-spin" /> : null}
          {translate('auto.components.settings.ClaudeLongLivedTokenDialog.save', 'Save token')}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {translate(
          'auto.components.settings.ClaudeLongLivedTokenDialog.pasteHint',
          'From claude setup-token run on this host while signed in as this account.'
        )}
      </p>
    </div>
  )
}
