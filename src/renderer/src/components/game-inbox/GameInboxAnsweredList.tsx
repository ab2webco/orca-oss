import React from 'react'
import type { GameAnsweredItem } from '../../../../shared/orchestrator-game-inbox-threads'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import { translate } from '@/i18n/i18n'
import { GameInboxKindTag } from './GameInboxKindTag'

/** What the lead answered members, newest first: the question, the answer and when. */
export function GameInboxAnsweredList({
  items,
  renderActions
}: {
  items: GameAnsweredItem[]
  renderActions?: (item: GameAnsweredItem) => React.ReactNode
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {translate(
          'auto.components.game-inbox.GameInboxAnsweredList.empty',
          'The lead has not answered a member yet.'
        )}
      </p>
    )
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li
          key={item.id}
          data-testid={`game-inbox-answered-${item.id}`}
          className="space-y-2 rounded-xl border border-border bg-card p-4 text-card-foreground"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="shrink-0 font-mono font-medium text-foreground">{item.ticket}</span>
            <GameInboxKindTag kind={item.kind} />
            <span className="truncate">
              {translate(
                'auto.components.game-inbox.GameInboxAnsweredList.answeredAt',
                'answered {{when}}',
                { when: formatUiRelativeTimeFromDate(item.answeredAt) }
              )}
            </span>
          </div>
          <p className="text-sm break-words whitespace-pre-wrap">{item.question}</p>
          <p className="border-l-2 border-border pl-3 text-sm break-words whitespace-pre-wrap text-muted-foreground">
            {item.answer}
          </p>
          {item.overriddenBy ? (
            <p className="border-l-2 border-foreground pl-3 text-sm break-words whitespace-pre-wrap">
              {translate(
                'auto.components.game-inbox.GameInboxAnsweredList.overridden',
                'You replaced it: {{text}}',
                { text: item.overriddenBy.text }
              )}
            </p>
          ) : null}
          {renderActions?.(item)}
        </li>
      ))}
    </ul>
  )
}
