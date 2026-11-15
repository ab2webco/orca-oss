import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { beginClaudeSetupTokenForNewAccount } from '@/runtime/runtime-claude-setup-token-client'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import { ClaudeSetupTokenGenerate } from './ClaudeSetupTokenGenerate'

type ClaudeTokenAccountDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  /** The host can run `claude setup-token` for a new account. */
  canGenerate: boolean
  /** A pasted token goes through this desktop's IPC, so a paired client cannot. */
  canPaste: boolean
  onAdded: (accounts: ClaudeRateLimitAccountsState) => void
}

/** Adds a Claude account from a long-lived token alone (ORCA-1215). */
export function ClaudeTokenAccountDialog({
  open,
  onOpenChange,
  settings,
  canGenerate,
  canPaste,
  onAdded
}: ClaudeTokenAccountDialogProps): React.JSX.Element {
  const [label, setLabel] = useState('')
  const name = label.trim()
  const nothingAdded = translate(
    'auto.components.settings.ClaudeTokenAccountDialog.nothingAdded',
    'Nothing was added.'
  )
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setLabel('')
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          {/* Why the side padding: on a narrow screen the centered title would run under the close button. */}
          <DialogTitle className="max-sm:px-6">
            {translate(
              'auto.components.settings.ClaudeTokenAccountDialog.title',
              'Add account with a token'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.ClaudeTokenAccountDialog.description',
              'Uses a one-year token from claude setup-token, with no browser sign-in first. The token cannot read the account’s email, so name the account yourself.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="claude-token-account-label">
            {translate(
              'auto.components.settings.ClaudeTokenAccountDialog.nameLabel',
              'Name or email'
            )}
          </Label>
          <Input
            id="claude-token-account-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            className="text-xs"
          />
        </div>
        {canGenerate ? (
          // Why keyed by the name: renaming mid sign-in restarts it, so the account gets the shown name.
          <ClaudeSetupTokenGenerate
            key={name}
            settings={settings}
            begin={() => beginClaudeSetupTokenForNewAccount(settings, name)}
            accountLabel={name}
            onStored={onAdded}
            disabled={name === ''}
            failureNote={nothingAdded}
          />
        ) : null}
        {/* Why: DialogContent unmounts on close, so a typed secret never survives into the next open. */}
        {canPaste ? (
          <PasteToken
            collapsed={canGenerate}
            label={name}
            failureNote={nothingAdded}
            onAdded={onAdded}
          />
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.settings.ClaudeTokenAccountDialog.limits',
            'Agents and members assigned to it launch on the token. It cannot be the shared login, and its usage cannot be shown. Sign in again on its row later to give it its real email.'
          )}
        </p>
      </DialogContent>
    </Dialog>
  )
}

function PasteToken({
  collapsed,
  label,
  failureNote,
  onAdded
}: {
  collapsed: boolean
  label: string
  failureNote: string
  onAdded: (accounts: ClaudeRateLimitAccountsState) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(!collapsed)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const add = (): void => {
    setSubmitting(true)
    setError(null)
    void window.api.claudeAccounts
      .addFromLongLivedToken({ label, token: draft })
      .then(onAdded, (cause: unknown) =>
        setError(
          (cause instanceof Error ? cause.message : String(cause)).replace(
            /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
            ''
          )
        )
      )
      .finally(() => setSubmitting(false))
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="claude-token-account-token">
        {translate('auto.components.settings.ClaudeLongLivedTokenDialog.inputLabel', 'Token')}
      </Label>
      <div className="flex gap-2">
        <Input
          id="claude-token-account-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          // Why uncontrolled: React mirrors a controlled value into the `value` attribute, i.e. the DOM.
          onChange={(event) => setDraft(event.target.value)}
          className="min-w-0 text-xs"
        />
        <Button
          variant="outline"
          onClick={add}
          disabled={submitting || label === '' || draft.trim() === ''}
          className="gap-1.5"
        >
          {submitting ? <Loader2 className="size-3 animate-spin" /> : null}
          {translate('auto.components.settings.ClaudeTokenAccountDialog.add', 'Add account')}
        </Button>
      </div>
      {error ? (
        <div role="alert" className="space-y-0.5 text-xs">
          <p className="break-words text-destructive">{error}</p>
          <p className="text-muted-foreground">{failureNote}</p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.settings.ClaudeTokenAccountDialog.pasteHint',
            'From claude setup-token, run while signed in as the account you are adding.'
          )}
        </p>
      )}
    </div>
  )
}
