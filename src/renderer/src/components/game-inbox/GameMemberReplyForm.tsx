import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : translate('auto.components.game-inbox.GameMemberReplyForm.failed', 'The reply was not sent.')
}

/** The person's words for a member, sent through the lead; a failed send says why and keeps the text. */
export function GameMemberReplyForm({
  id,
  ticket,
  placeholder,
  onReply
}: {
  id: string
  ticket: string
  placeholder: string
  onReply: (text: string) => Promise<void>
}): React.JSX.Element {
  const [text, setText] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputId = `game-member-reply-${id}`
  const typed = text.trim()

  return (
    // Why stacked in a narrow card: beside Send, the placeholder is cut mid-word at 320px.
    <div className="@container space-y-2">
      <form
        className="flex flex-col gap-2 @xs:flex-row @xs:items-center"
        onSubmit={(event) => {
          event.preventDefault()
          if (!typed) {
            return
          }
          setSending(true)
          setError(null)
          onReply(typed)
            .then(() => setText(''))
            .catch((cause: unknown) => setError(errorText(cause)))
            .finally(() => setSending(false))
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          {translate(
            'auto.components.game-inbox.GameMemberReplyForm.label',
            'Your answer to {{ticket}}',
            { ticket }
          )}
        </label>
        <Input
          id={inputId}
          value={text}
          disabled={sending}
          placeholder={placeholder}
          className="h-8 min-w-0 text-sm @xs:flex-1"
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit" size="sm" className="self-end" disabled={sending || !typed}>
          {translate('auto.components.game-inbox.GameMemberReplyForm.send', 'Send')}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-xs break-words text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Hidden until asked for: overriding the lead is the exception, not the default. */
export function GameMemberOverride({
  id,
  ticket,
  onReply
}: {
  id: string
  ticket: string
  onReply: (text: string) => Promise<void>
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  return open ? (
    <GameMemberReplyForm
      id={id}
      ticket={ticket}
      placeholder={translate(
        'auto.components.game-inbox.GameMemberReplyForm.overridePlaceholder',
        "Replace the lead's answer"
      )}
      onReply={onReply}
    />
  ) : (
    <Button type="button" variant="ghost" size="xs" onClick={() => setOpen(true)}>
      {translate('auto.components.game-inbox.GameMemberReplyForm.override', 'Override')}
    </Button>
  )
}
