import React from 'react'
import { ExternalLink } from 'lucide-react'
import type {
  GameOwnerQuestion,
  GameOwnerReply
} from '../../../../shared/orchestrator-game-owner-questions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import { translate } from '@/i18n/i18n'

const isLink = (value: string): boolean => /^https?:\/\/\S+$/i.test(value)

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : translate(
        'auto.components.game-inbox.GameOwnerQuestionCard.failed',
        'The answer was not sent.'
      )
}

/** One open question the lead asked the person: its options as buttons, or a typed answer. */
export function GameOwnerQuestionCard({
  question,
  onAnswer
}: {
  question: GameOwnerQuestion
  onAnswer: (reply: GameOwnerReply) => Promise<void>
}): React.JSX.Element {
  const [text, setText] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const answerId = `game-owner-answer-${question.id}`

  const send = (reply: GameOwnerReply): void => {
    setSending(true)
    setError(null)
    onAnswer(reply)
      .catch((cause: unknown) => setError(errorText(cause)))
      .finally(() => setSending(false))
  }
  const typed = text.trim()

  return (
    <article
      className="@container space-y-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
      data-game-owner-question={question.id}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {question.ticket ? (
          <span className="shrink-0 font-mono font-medium text-foreground">{question.ticket}</span>
        ) : null}
        <span className="truncate">{formatUiRelativeTimeFromDate(question.askedAt)}</span>
      </div>
      <p className="text-sm break-words whitespace-pre-wrap">{question.question}</p>
      {question.context ? (
        isLink(question.context) ? (
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto max-w-full justify-start gap-1 p-0 text-xs has-[>svg]:px-0"
            onClick={() => void window.api.shell.openUrl(question.context ?? '')}
          >
            <ExternalLink className="size-3 shrink-0" />
            <span className="truncate">{question.context}</span>
          </Button>
        ) : (
          <p className="text-xs break-words text-muted-foreground">{question.context}</p>
        )
      ) : null}
      {question.options.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {question.options.map((option, index) => (
            <Button
              key={option}
              type="button"
              variant="outline"
              size="sm"
              className="h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal"
              disabled={sending}
              onClick={() => send({ option: index + 1 })}
            >
              {option}
            </Button>
          ))}
        </div>
      ) : null}
      {/* Why stacked in a narrow card: beside Send, the placeholder is cut mid-word at 320px. */}
      <form
        className="flex flex-col gap-2 @xs:flex-row @xs:items-center"
        onSubmit={(event) => {
          event.preventDefault()
          if (typed) {
            send({ text: typed })
          }
        }}
      >
        <label htmlFor={answerId} className="sr-only">
          {translate('auto.components.game-inbox.GameOwnerQuestionCard.yourAnswer', 'Your answer')}
        </label>
        <Input
          id={answerId}
          value={text}
          disabled={sending}
          placeholder={translate(
            'auto.components.game-inbox.GameOwnerQuestionCard.placeholder',
            'Answer in your own words'
          )}
          className="h-8 min-w-0 text-sm @xs:flex-1"
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit" size="sm" className="self-end" disabled={sending || !typed}>
          {translate('auto.components.game-inbox.GameOwnerQuestionCard.send', 'Send')}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-xs break-words text-destructive">
          {error}
        </p>
      ) : null}
    </article>
  )
}
