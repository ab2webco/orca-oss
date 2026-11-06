import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/StatusDot'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import type { TeamMemberCard, TeamPullRequest } from '../../../../shared/team-panel-model-types'
import {
  teamHostText,
  teamLiveText,
  teamModelText,
  teamPhaseText,
  teamStatusTone
} from './team-card-text'
import type { SelectTeamPanelTab } from './team-panel-tab-definition'

function ciText(pr: TeamPullRequest): string | null {
  if (pr.state === 'merged') {
    return translate('teamPanel.card.merged', 'Merged')
  }
  switch (pr.ci) {
    case 'failure':
      return translate('teamPanel.card.ciFailed', 'CI failing')
    case 'pending':
      return translate('teamPanel.card.ciRunning', 'CI running')
    case 'success':
      return translate('teamPanel.card.ciPassed', 'CI green')
    case 'neutral':
    case 'none':
      return null
  }
}

/** Splits a row's meta into `a · b · c` with the separators drawn by the parent. */
export function MetaLine({ parts }: { parts: (string | null)[] }): React.JSX.Element | null {
  const shown = parts.filter((part): part is string => Boolean(part))
  if (shown.length === 0) {
    return null
  }
  return (
    <span className="flex min-w-0 items-center gap-1 truncate text-[11.5px] text-muted-foreground/80">
      {shown.join(' · ')}
    </span>
  )
}

export function TeamMemberCardRow({
  card,
  showName,
  expanded,
  onToggle,
  selectTab,
  now
}: {
  card: TeamMemberCard
  showName: boolean
  expanded: boolean
  onToggle: () => void
  selectTab: SelectTeamPanelTab
  now: number
}): React.JSX.Element {
  // Why: a member launched by ticket is named after it, and the card would print it twice.
  const ticketShown = card.ticket && !(showName && card.name === card.ticket.identifier)
  const answer = card.needsYou ? (
    <Button size="xs" onClick={() => selectTab('inbox')}>
      {translate('teamPanel.card.answerInInbox', 'Answer in Inbox')}
    </Button>
  ) : null
  const ci = card.pr ? ciText(card.pr) : null
  return (
    <article data-team-card="member" data-pane-key={card.paneKey}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          'flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left hover:bg-sidebar-accent',
          expanded && 'bg-sidebar-accent'
        )}
      >
        <span className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
          {showName ? <span className="truncate text-[13px] font-medium">{card.name}</span> : null}
          {ticketShown && card.ticket ? (
            <code className="font-mono text-[11.5px] text-muted-foreground">
              {card.ticket.identifier}
            </code>
          ) : null}
          <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
            {teamHostText(card.host)}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot tone={teamStatusTone(card.status)} />
          {/* Why: the line names what the tone shows; the question itself is only in Inbox. */}
          <span className={cn('truncate', card.needsYou && 'text-status-attention')}>
            {card.needsYou
              ? translate('teamPanel.card.waitingForAnswer', 'Waiting for your answer')
              : teamLiveText(card.liveAction, card.condition)}
          </span>
        </span>
        <MetaLine
          parts={[
            teamModelText(card.model),
            card.flowPhase ? teamPhaseText(card.flowPhase) : null,
            card.since !== null ? formatUiRelativeTime(card.since - now) : null
          ]}
        />
      </button>
      {answer && !expanded ? <div className="px-3 pb-2">{answer}</div> : null}
      {expanded ? (
        <div className="flex flex-col items-start gap-2 bg-sidebar-accent/50 px-3 pb-3 pt-1 text-xs">
          {answer}
          {card.ticket?.title ? (
            <p className="break-words text-[13px] text-foreground">{card.ticket.title}</p>
          ) : null}
          {card.summary ? (
            <p className="break-words text-muted-foreground">{card.summary}</p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {card.pr ? (
              <a
                href={card.pr.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground"
              >
                {`#${card.pr.number}${ci ? ` · ${ci}` : ''}`}
              </a>
            ) : null}
            {card.account ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                {card.account.usedPercent !== null
                  ? `${card.account.email} · ${card.account.usedPercent}%`
                  : card.account.email}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  )
}
