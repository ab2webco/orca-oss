import React from 'react'
import type { GameOwnerQuestion } from '../../../../shared/orchestrator-game-owner-questions'
import { translate } from '@/i18n/i18n'

/** Answers the person gave that the board still holds: no lead has taken them yet (ORCA-1100). */
export function GameInboxUndelivered({
  questions
}: {
  questions: GameOwnerQuestion[]
}): React.JSX.Element | null {
  if (questions.length === 0) {
    return null
  }
  return (
    <section
      data-testid="game-inbox-undelivered"
      role="status"
      className="space-y-2 rounded-xl border border-border bg-card p-4 text-card-foreground"
    >
      <p className="text-sm font-medium">
        {translate(
          'auto.components.game-inbox.GameInboxUndelivered.title',
          'Your answer has not reached the lead yet. Orca delivers it as soon as a lead takes it.'
        )}
      </p>
      <ul className="space-y-1">
        {questions.map((question) => (
          <li
            key={question.id}
            className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground"
          >
            {question.ticket ? (
              <span className="shrink-0 font-mono font-medium text-foreground">
                {question.ticket}
              </span>
            ) : null}
            <span className="min-w-0 break-words">{question.question}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
