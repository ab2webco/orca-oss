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

type ClaudeLongLivedTokenDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountLabel: string
  hasToken: boolean
  submitting: boolean
  onSave: (token: string) => void
  onClear: () => void
}

export function ClaudeLongLivedTokenDialog({
  open,
  onOpenChange,
  accountLabel,
  hasToken,
  submitting,
  onSave,
  onClear
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
              'auto.components.settings.ClaudeLongLivedTokenDialog.description',
              'Run claude setup-token on this host while signed in as {{value0}}, then paste the token. Agents on this account use it instead of the stored login, so they stop rotating it.',
              { value0: accountLabel }
            )}
          </DialogDescription>
        </DialogHeader>
        {/* Why: DialogContent unmounts on close, so a typed secret never survives into the next open. */}
        <TokenFields
          hasToken={hasToken}
          submitting={submitting}
          onSave={onSave}
          onClear={onClear}
        />
      </DialogContent>
    </Dialog>
  )
}

function TokenFields({
  hasToken,
  submitting,
  onSave,
  onClear
}: Pick<
  ClaudeLongLivedTokenDialogProps,
  'hasToken' | 'submitting' | 'onSave' | 'onClear'
>): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const canSave = draft.trim().length > 0 && !submitting

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="claude-long-lived-token">
          {translate('auto.components.settings.ClaudeLongLivedTokenDialog.inputLabel', 'Token')}
        </Label>
        <Input
          id="claude-long-lived-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            hasToken
              ? translate(
                  'auto.components.settings.ClaudeLongLivedTokenDialog.replacePlaceholder',
                  'A token is stored. Paste a new one to replace it.'
                )
              : undefined
          }
          className="text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.settings.ClaudeLongLivedTokenDialog.limits',
            'The token only makes model requests: Remote Control and claude.ai connectors do not work with it. It stays on this host.'
          )}
        </p>
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        {hasToken ? (
          <Button variant="outline" onClick={onClear} disabled={submitting}>
            {translate(
              'auto.components.settings.ClaudeLongLivedTokenDialog.remove',
              'Remove token'
            )}
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={() => onSave(draft)} disabled={!canSave} className="gap-1.5">
          {submitting ? <Loader2 className="size-3 animate-spin" /> : null}
          {translate('auto.components.settings.ClaudeLongLivedTokenDialog.save', 'Save token')}
        </Button>
      </DialogFooter>
    </>
  )
}
