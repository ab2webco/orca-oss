import React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronLeft } from 'lucide-react'
import type {
  GameInboxThread,
  GameThreadMessage
} from '../../../../shared/orchestrator-game-inbox-threads'
import { Button } from '@/components/ui/button'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import { translate } from '@/i18n/i18n'
import { GameInboxKindTag } from './GameInboxKindTag'

function failureText(message: GameThreadMessage): string | null {
  const failure = message.failure
  if (!failure) {
    return null
  }
  const label =
    failure.kind === 'rejected'
      ? translate('auto.components.game-inbox.GameInboxThreadsView.rejected', 'Rejected')
      : translate('auto.components.game-inbox.GameInboxThreadsView.failed', 'Failed')
  return failure.reason ? `${label}: ${failure.reason}` : label
}

function ThreadMessage({ message }: { message: GameThreadMessage }): React.JSX.Element {
  const failure = failureText(message)
  return (
    <article
      data-testid={`game-inbox-message-${message.id}`}
      className="space-y-1.5 border-b border-border px-4 py-3"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="shrink-0 font-mono font-medium text-foreground">{message.from}</span>
        <span aria-hidden>→</span>
        <span className="shrink-0 font-mono">{message.to}</span>
        <GameInboxKindTag kind={message.kind} failed={failure !== null} />
        <span className="ml-auto shrink-0">{formatUiRelativeTimeFromDate(message.at)}</span>
      </div>
      <p className="text-[13px] font-medium break-words">{message.subject}</p>
      {message.body ? (
        <p className="line-clamp-6 text-xs break-words whitespace-pre-wrap text-muted-foreground">
          {message.body}
        </p>
      ) : null}
      {failure ? (
        <p role="alert" className="text-xs break-words text-destructive">
          {failure}
        </p>
      ) : null}
    </article>
  )
}

// Why virtualized: a long-running member's thread holds up to 200 messages.
function ThreadMessages({ thread }: { thread: GameInboxThread }): React.JSX.Element {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: thread.messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 6
  })
  const count = thread.messages.length
  // Why: open on the newest message, and follow new mail as the thread grows.
  React.useEffect(() => {
    if (count > 0) {
      virtualizer.scrollToIndex(count - 1, { align: 'end' })
    }
  }, [count, virtualizer])
  return (
    <div
      ref={scrollRef}
      className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto"
      data-testid="game-inbox-thread-messages"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const message = thread.messages[row.index]
          return message ? (
            <div
              key={message.id}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <ThreadMessage message={message} />
            </div>
          ) : null
        })}
      </div>
    </div>
  )
}

/** Every ticket's conversation with the lead; picking one shows its messages, oldest first. */
export function GameInboxThreadsView({
  threads
}: {
  threads: GameInboxThread[]
}): React.JSX.Element {
  const [selected, setSelected] = React.useState<string | null>(null)
  const thread = selected ? threads.find((one) => one.ticket === selected) : undefined

  if (thread) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
            <ChevronLeft className="size-4" />
            {translate('auto.components.game-inbox.GameInboxThreadsView.back', 'All threads')}
          </Button>
          <span className="ml-auto pr-2 font-mono text-xs font-medium">{thread.ticket}</span>
        </div>
        <ThreadMessages thread={thread} />
      </div>
    )
  }
  if (threads.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        {translate(
          'auto.components.game-inbox.GameInboxThreadsView.empty',
          'No member has talked with the lead yet.'
        )}
      </p>
    )
  }
  return (
    <ul className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {threads.map((one) => {
        const last = one.messages.at(-1)
        return (
          <li key={one.ticket}>
            <button
              type="button"
              data-testid={`game-inbox-thread-${one.ticket}`}
              onClick={() => setSelected(one.ticket)}
              className="flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-2 text-left hover:bg-accent"
            >
              <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono text-[13px] font-medium text-foreground">
                  {one.ticket}
                </span>
                {one.waiting > 0 ? (
                  <span className="rounded-full border border-border px-1.5 text-[10px] font-semibold tabular-nums">
                    {translate(
                      'auto.components.game-inbox.GameInboxThreadsView.waiting',
                      '{{count}} waiting',
                      { count: one.waiting }
                    )}
                  </span>
                ) : null}
                <span className="ml-auto shrink-0">{formatUiRelativeTimeFromDate(one.last)}</span>
              </span>
              {last ? (
                <span className="truncate text-xs text-muted-foreground">
                  {last.from}: {last.subject}
                </span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
