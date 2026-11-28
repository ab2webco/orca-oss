import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { GameStuckReason } from '../../../../shared/orchestrator-game-inbox'

function stuckText(reason: GameStuckReason): string {
  switch (reason) {
    case 'legacy_run':
      return translate(
        'teamPanel.inbox.stuckLegacyRun',
        'No reply can reach it: it is in an old Run.'
      )
    case 'reminted_lead':
      return translate(
        'teamPanel.inbox.stuckRemintedLead',
        "No reply can reach it: it went to the lead's old terminal."
      )
    case 'gone_sender':
      return translate(
        'teamPanel.inbox.stuckGoneSender',
        'No reply can reach it: its sender is gone.'
      )
  }
}

/**
 * A wait no reply can settle (ORCA-1482): Dismiss first asks why, and only the second Dismiss
 * settles it, keeping the note in the lead's inbox as the audit.
 */
export function TeamInboxDismiss({
  id,
  reason,
  onDismiss
}: {
  id: string
  reason: GameStuckReason
  onDismiss: (note: string) => Promise<void>
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [note, setNote] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const typed = note.trim()
  const inputId = `team-inbox-dismiss-${id}`
  const dismissLabel = translate('teamPanel.inbox.dismiss', 'Dismiss')
  return (
    <div className="space-y-1.5" data-team-inbox-dismiss={id}>
      <p className="text-xs break-words text-muted-foreground">{stuckText(reason)}</p>
      {open ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!typed) {
              return
            }
            setSending(true)
            setError(null)
            onDismiss(typed)
              .catch((cause: unknown) =>
                setError(
                  cause instanceof Error && cause.message
                    ? cause.message
                    : translate('teamPanel.inbox.dismissFailed', 'It was not dismissed.')
                )
              )
              .finally(() => setSending(false))
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            {translate('teamPanel.inbox.dismissNoteLabel', 'Why you dismiss it')}
          </label>
          <Input
            id={inputId}
            autoFocus
            value={note}
            disabled={sending}
            placeholder={translate('teamPanel.inbox.dismissNote', 'Why (kept as a note)')}
            className="h-8 min-w-0 text-sm"
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={sending}
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
            >
              {translate('teamPanel.inbox.dismissCancel', 'Cancel')}
            </Button>
            <Button type="submit" variant="destructive" size="sm" disabled={sending || !typed}>
              {dismissLabel}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-xs break-words text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <Button type="button" variant="ghost" size="xs" onClick={() => setOpen(true)}>
          {dismissLabel}
        </Button>
      )}
    </div>
  )
}
