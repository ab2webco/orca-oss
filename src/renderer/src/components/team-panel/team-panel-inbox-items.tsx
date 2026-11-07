import type { GameOwnerQuestion } from '../../../../shared/orchestrator-game-owner-questions'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type {
  GameAnsweredItem,
  GameWaitingItem
} from '../../../../shared/orchestrator-game-inbox-threads'
import { teamAgeText, teamHostText } from './team-card-text'
import type { TeamInboxAgentQuestion } from './team-panel-inbox-agents'

/** A session blocked on the user; its options are shown, answered in its own terminal. */
export function TeamInboxAgentCard({
  question,
  onOpen
}: {
  question: TeamInboxAgentQuestion
  onOpen: (question: TeamInboxAgentQuestion) => void
}): React.JSX.Element {
  const place = [question.repoName, question.worktreeName]
  if (question.host.kind === 'remote') {
    place.push(teamHostText(question.host))
  }
  return (
    <article
      data-team-inbox-agent={question.paneKey}
      className="space-y-2 rounded-xl border border-border bg-card p-4 text-card-foreground"
    >
      <p className="truncate text-xs text-muted-foreground">{place.join(' · ')}</p>
      <p className="text-sm break-words whitespace-pre-wrap">{question.text}</p>
      {question.options.length > 0 ? (
        <p className="text-xs break-words text-muted-foreground">{question.options.join(' · ')}</p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!question.worktreeId}
        onClick={() => onOpen(question)}
      >
        {translate('teamPanel.inbox.openTerminal', 'Open terminal')}
      </Button>
    </article>
  )
}

// Why self-start: the Answer and Override buttons are buttons, not full-width rows.
const ROW = 'flex min-w-0 flex-col gap-0.5 py-2 [&>button]:self-start'

function RowHead({ ticket, at, now }: { ticket: string | null; at: string | null; now: number }) {
  const since = at ? Date.parse(at) : Number.NaN
  return (
    <span className="flex min-w-0 items-baseline gap-2 text-xs">
      {ticket ? <code className="font-mono font-semibold text-foreground">{ticket}</code> : null}
      {Number.isNaN(since) ? null : (
        <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
          {teamAgeText(since, now)}
        </span>
      )}
    </span>
  )
}

/** What members ask the lead, as V28's compact list; answering it yourself is one click away. */
export function TeamInboxWaitingRows({
  items,
  memberNames,
  now,
  renderActions
}: {
  items: GameWaitingItem[]
  memberNames: ReadonlyMap<string, string>
  now: number
  renderActions: (item: GameWaitingItem) => React.ReactNode
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        {translate('teamPanel.inbox.waitingEmpty', 'No member is waiting for an answer.')}
      </p>
    )
  }
  return (
    <ul>
      {items.map((item) => {
        const name = memberNames.get(item.ticket)
        const asker = name && name !== item.ticket ? name : null
        return (
          <li key={item.id} data-testid={`team-inbox-waiting-${item.id}`} className={ROW}>
            <RowHead ticket={item.ticket} at={item.at} now={now} />
            <p className="text-[13px] break-words text-muted-foreground">
              {asker ? `${asker}: ${item.body}` : item.body}
            </p>
            {renderActions(item)}
          </li>
        )
      })}
    </ul>
  )
}

/** Everything answered, newest first, in V28's one plain list. */
export function TeamInboxAnsweredRows({
  yours,
  lead,
  now,
  renderOverride
}: {
  yours: GameOwnerQuestion[]
  lead: GameAnsweredItem[]
  now: number
  renderOverride: (item: GameAnsweredItem) => React.ReactNode
}): React.JSX.Element {
  const rows = [
    ...yours.map((one) => ({ kind: 'yours' as const, at: one.answer?.at ?? '', one })),
    ...lead.map((one) => ({ kind: 'lead' as const, at: one.answeredAt, one }))
  ].sort((a, b) => b.at.localeCompare(a.at))
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        {translate('teamPanel.inbox.answeredEmpty', 'Nothing answered yet.')}
      </p>
    )
  }
  return (
    <ul>
      {rows.map((row) =>
        row.kind === 'yours' ? (
          <li key={row.one.id} data-testid={`team-inbox-answered-${row.one.id}`} className={ROW}>
            <RowHead ticket={row.one.ticket} at={row.at} now={now} />
            <p className="text-[13px] break-words">{row.one.question}</p>
            <p className="text-[13px] break-words text-muted-foreground">
              {translate('teamPanel.inbox.youAnsweredText', 'You answered: {{text}}', {
                text: row.one.answer?.text ?? ''
              })}
            </p>
          </li>
        ) : (
          <li key={row.one.id} data-testid={`team-inbox-answered-${row.one.id}`} className={ROW}>
            <RowHead ticket={row.one.ticket} at={row.at} now={now} />
            <p className="text-[13px] break-words">{row.one.question}</p>
            <p className="text-[13px] break-words text-muted-foreground">
              {row.one.overriddenBy
                ? translate('teamPanel.inbox.youAnsweredText', 'You answered: {{text}}', {
                    text: row.one.overriddenBy.text
                  })
                : translate('teamPanel.inbox.leadAnsweredText', 'The lead answered: {{text}}', {
                    text: row.one.answer
                  })}
            </p>
            {renderOverride(row.one)}
          </li>
        )
      )}
    </ul>
  )
}
