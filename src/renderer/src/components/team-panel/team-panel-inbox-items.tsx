import React from 'react'
import type { GameOwnerQuestion } from '../../../../shared/orchestrator-game-owner-questions'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { TeamStatusMark } from './TeamStatusMark'
import type {
  GameAnsweredItem,
  GameWaitingItem
} from '../../../../shared/orchestrator-game-inbox-threads'
import { ticketInText } from '../../../../shared/orchestrator-game-ticket-id'
import { teamAgeText, teamHostText } from './team-card-text'
import type { TeamInboxAgentQuestion } from './team-panel-inbox-agents'

/** A session blocked on the user; V28's option buttons answer it, its terminal stays one click away. */
export function TeamInboxAgentCard({
  question,
  onOpen,
  onAnswer
}: {
  question: TeamInboxAgentQuestion
  onOpen: (question: TeamInboxAgentQuestion) => void
  /** Null when one option cannot answer it, as with several questions or a multi-select. */
  onAnswer: ((optionIndex: number) => boolean) | null
}): React.JSX.Element {
  // Why hold the buttons: a second tap would type its digit into the agent's next turn.
  const [sent, setSent] = React.useState(false)
  // Why: a team's question sits under its project, so V28's card names only who asks.
  const needsYou = question.asker !== undefined
  const place = [question.repoName, question.worktreeName]
  if (question.host.kind === 'remote') {
    place.push(teamHostText(question.host))
  }
  return (
    <article
      data-team-inbox-agent={question.paneKey}
      data-needs-you={needsYou ? 'true' : undefined}
      className={cn(
        'space-y-2 rounded-xl border p-4 text-card-foreground',
        needsYou ? 'border-status-attention/30 bg-status-attention/10' : 'border-border bg-card'
      )}
    >
      {needsYou ? (
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-status-attention">
            <TeamStatusMark status="attention" />
            {translate('auto.components.game-inbox.GameOwnerQuestionCard.needsYou', 'Needs you')}
          </span>
          <span className="ml-auto truncate font-mono font-medium text-muted-foreground">
            {question.asker}
          </span>
        </div>
      ) : (
        <p className="truncate text-xs text-muted-foreground">{place.join(' · ')}</p>
      )}
      <p className="text-sm break-words whitespace-pre-wrap">{question.text}</p>
      {question.options.length > 0 && !onAnswer ? (
        <p className="text-xs break-words text-muted-foreground">{question.options.join(' · ')}</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {onAnswer
          ? question.options.map((option, index) => (
              <Button
                key={option}
                type="button"
                variant={index === 0 ? 'default' : needsYou ? 'secondary' : 'outline'}
                size="sm"
                className="h-auto min-h-8 max-w-full whitespace-normal break-words text-left"
                disabled={sent}
                onClick={() => setSent(onAnswer(index))}
              >
                {option}
              </Button>
            ))
          : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!question.worktreeId && !question.terminalHandle}
          onClick={() => onOpen(question)}
        >
          {translate('teamPanel.inbox.openTerminal', 'Open terminal')}
        </Button>
      </div>
    </article>
  )
}

// Why self-start: the Answer and Override buttons are buttons, not full-width rows.
const ROW = 'flex min-w-0 flex-col gap-0.5 py-2 [&>button]:self-start'

// Why: a member with no ticket (an adopted agent) is keyed by its name; a raw dispatch id is never shown.
function memberOfKey(key: string | null): { ticket: string | null; name: string | null } {
  if (!key || key.startsWith('dispatch:')) {
    return { ticket: null, name: null }
  }
  return ticketInText(key) === key ? { ticket: key, name: null } : { ticket: null, name: key }
}

function RowHead({ member, at, now }: { member: string | null; at: string | null; now: number }) {
  const since = at ? Date.parse(at) : Number.NaN
  const { ticket, name } = memberOfKey(member)
  return (
    <span className="flex min-w-0 items-baseline gap-2 text-xs">
      {ticket ? <code className="font-mono font-semibold text-foreground">{ticket}</code> : null}
      {name ? <span className="truncate font-medium text-foreground">{name}</span> : null}
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
        const { ticket, name } = memberOfKey(item.ticket)
        const character = ticket ? memberNames.get(ticket) : undefined
        const asker = name ?? (character && character !== ticket ? character : null)
        return (
          <li key={item.id} data-testid={`team-inbox-waiting-${item.id}`} className={ROW}>
            <RowHead member={ticket} at={item.at} now={now} />
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
            <RowHead member={row.one.ticket} at={row.at} now={now} />
            <p className="text-[13px] break-words">{row.one.question}</p>
            <p className="text-[13px] break-words text-muted-foreground">
              {translate('teamPanel.inbox.youAnsweredText', 'You answered: {{text}}', {
                text: row.one.answer?.text ?? ''
              })}
            </p>
          </li>
        ) : (
          <li key={row.one.id} data-testid={`team-inbox-answered-${row.one.id}`} className={ROW}>
            <RowHead member={row.one.ticket} at={row.at} now={now} />
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
