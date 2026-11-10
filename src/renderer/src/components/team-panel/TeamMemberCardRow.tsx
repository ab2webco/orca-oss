import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { TeamMemberCard } from '../../../../shared/team-panel-model-types'
import {
  teamAgeText,
  teamHostText,
  teamLiveText,
  teamModelText,
  teamPhaseText,
  teamTicketBesideName
} from './team-card-text'
import { TeamStatusMark } from './TeamStatusMark'
import { TeamCardFace } from './TeamCardFace'
import { TeamMemberCardDetail } from './TeamMemberCardDetail'
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
    // Why wrap, not cut: at 320 the phase and age matter more than one line.
    <span
      data-team-meta=""
      className="flex min-w-0 flex-wrap items-center gap-x-1 text-[11.5px] text-muted-foreground/80"
    >
      {model ? (
        <code data-team-model="" className="shrink-0 font-mono">
          {model}
        </code>
      ) : null}
      {shown.length > 0 ? (
        <span className="min-w-0 break-words">{`${model ? '· ' : ''}${shown.join(' · ')}`}</span>
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
  const shownName = showName ? card.name : (card.ticket?.identifier ?? card.name)
  // Why only on opening: a second click folds the card and leaves the center as it is.
  const toggle = (): void => {
    if (!expanded && (card.terminalHandle || card.worktreeId)) {
      void openTeamSession(card, shownName)
    }
    onToggle()
  }
  return (
    <article data-team-card="member" data-pane-key={card.paneKey}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={toggle}
        className={cn(
          'flex w-full min-w-0 items-start gap-2.5 py-2 pr-3 text-left hover:bg-sidebar-accent',
          // Why indented: V28's Plain and Display looks set members under the lead (ORCA-1094).
          showName ? 'pl-3' : 'pl-5',
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
        ) : (
          <span data-team-status-column="" className="flex shrink-0 self-center">
            <TeamStatusMark status={card.status} />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Why wrap: short of room, the host and then the ticket move below before the name is cut. */}
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 whitespace-nowrap">
            {showName ? (
              <span data-team-name="" className="min-w-0 truncate text-[13px] font-medium">
                {card.name}
              </span>
            ) : null}
            {ticket ? (
              <code className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
                {ticket}
              </code>
            ) : null}
            <span
              data-team-host=""
              className="min-w-0 flex-1 basis-0 truncate text-right font-mono text-[11px] text-muted-foreground"
            >
              {teamHostText(card.host)}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {showName ? <TeamStatusMark status={card.status} /> : null}
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
              card.since !== null ? teamAgeText(card.since, now) : null,
              card.inFolder
                ? translate('teamPanel.card.inFolder', 'In the folder, no worktree')
                : null
            ]}
          />
        </span>
      </button>
      {answer && !expanded ? <div className="px-3 pb-2">{answer}</div> : null}
      {expanded ? <TeamMemberCardDetail card={card} now={now} answer={answer} /> : null}
    </article>
  )
}
