import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/StatusDot'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { TeamMemberCard } from '../../../../shared/team-panel-model-types'
import {
  statusToneOfCi,
  teamAgeText,
  teamCiText,
  teamHostText,
  teamLiveText,
  teamModelText,
  teamPhaseText,
  teamTicketBesideName
} from './team-card-text'
import { TeamStatusMark } from './TeamStatusMark'
import { TeamCardFace } from './TeamCardFace'
import type { SelectTeamPanelTab } from './team-panel-tab-definition'
import { openTeamSession } from './team-session-open'

/** A row's meta as `model · a · b`; the model is mono, as V28 sets it. */
export function MetaLine({
  model,
  parts
}: {
  model: string | null
  parts: (string | null)[]
}): React.JSX.Element | null {
  const shown = parts.filter((part): part is string => Boolean(part))
  if (!model && shown.length === 0) {
    return null
  }
  return (
    <span className="flex min-w-0 items-center gap-1 truncate whitespace-nowrap text-[11.5px] text-muted-foreground/80">
      {model ? (
        <code data-team-model="" className="shrink-0 font-mono">
          {model}
        </code>
      ) : null}
      {shown.length > 0 ? (
        <span className="truncate">{`${model ? '· ' : ''}${shown.join(' · ')}`}</span>
      ) : null}
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
  const ticket = teamTicketBesideName(card, showName)
  const answer = card.needsYou ? (
    <Button size="xs" onClick={() => selectTab('inbox')}>
      {translate('teamPanel.card.answerInInbox', 'Answer in Inbox')}
    </Button>
  ) : null
  const ci = card.pr ? teamCiText(card.pr) : null
  const ciTone = card.pr ? statusToneOfCi(card.pr) : null
  const shownName = showName ? card.name : (card.ticket?.identifier ?? card.name)
  return (
    <article data-team-card="member" data-pane-key={card.paneKey}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          'flex w-full min-w-0 items-start gap-2.5 px-3 py-2 text-left hover:bg-sidebar-accent',
          expanded && 'bg-sidebar-accent'
        )}
      >
        {showName ? (
          <TeamCardFace
            who={{
              role: 'member',
              key: card.paneKey,
              characterKey: card.characterKey,
              name: card.name
            }}
          />
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
            {showName ? (
              <span className="truncate text-[13px] font-medium">{card.name}</span>
            ) : null}
            {ticket ? (
              <code className="font-mono text-[11.5px] text-muted-foreground">{ticket}</code>
            ) : null}
            <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
              {teamHostText(card.host)}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <TeamStatusMark status={card.status} />
            {/* Why: the line names what the tone shows; the question itself is only in Inbox. */}
            <span className={cn('truncate', card.needsYou && 'text-status-attention')}>
              {card.needsYou
                ? translate('teamPanel.card.waitingForAnswer', 'Waiting for your answer')
                : teamLiveText(card.liveAction, card.condition)}
            </span>
          </span>
          <MetaLine
            model={teamModelText(card.model)}
            parts={[
              card.flowPhase ? teamPhaseText(card.flowPhase) : null,
              card.since !== null ? teamAgeText(card.since, now) : null
            ]}
          />
        </span>
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
                data-team-pr-chip=""
                href={card.pr.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground"
              >
                {ciTone ? <StatusDot tone={ciTone} /> : null}
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
          <Button size="xs" variant="outline" onClick={() => void openTeamSession(card, shownName)}>
            {translate('teamPanel.card.openTerminal', 'Open terminal')}
          </Button>
        </div>
      ) : null}
    </article>
  )
}
