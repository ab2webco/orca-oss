import React from 'react'
import type { GameWaitingItem } from '../../../../shared/orchestrator-game-inbox-threads'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import { translate } from '@/i18n/i18n'
import { GameInboxKindTag } from './GameInboxKindTag'

/** Member questions and decision gates nobody answered yet, the longest wait first. */
export function GameInboxWaitingList({
  items,
  renderActions
}: {
  items: GameWaitingItem[]
  renderActions?: (item: GameWaitingItem) => React.ReactNode
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {translate(
          'auto.components.game-inbox.GameInboxWaitingList.empty',
          'No member is waiting for an answer.'
        )}
      </p>
    )
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li
          key={item.id}
          data-testid={`game-inbox-waiting-${item.id}`}
          className="space-y-2 rounded-xl border border-border bg-card p-4 text-card-foreground"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="shrink-0 font-mono font-medium text-foreground">{item.ticket}</span>
            <GameInboxKindTag kind={item.kind} />
            <span className="truncate">{formatUiRelativeTimeFromDate(item.at)}</span>
            <span className="ml-auto shrink-0">
              {translate(
                'auto.components.game-inbox.GameInboxWaitingList.answerer',
                '{{answerer}} must answer',
                { answerer: item.answerer }
              )}
            </span>
          </div>
          <p className="text-sm break-words whitespace-pre-wrap">{item.body}</p>
          {renderActions?.(item)}
        </li>
      ))}
    </ul>
  )
}
