import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { TeamMemberCard } from '../../../../shared/team-panel-model-types'
import { teamIdleCiOf } from '../../../../shared/team-member-shown-state'
import {
  teamAgeText,
  teamAskText,
  teamHelpersCountText,
  teamMemberLiveText,
  teamModelText,
  teamPhaseText,
  teamTicketBesideName
} from './team-card-text'
import { TeamHostName } from './TeamHostName'
import { TeamStatusMark } from './TeamStatusMark'
import { TeamCardFace } from './TeamCardFace'
import { TeamMemberCardDetail } from './TeamMemberCardDetail'
import { TeamOpenTerminalButton } from './TeamOpenTerminalButton'
import type { SelectTeamPanelTab } from './team-panel-tab-definition'
import { openTeamSession } from './team-session-open'
import { teamHostWorktreeMissing } from './team-session-host-worktree'
import { teamHelpersOf } from './team-member-helpers'
import { useTeamSceneHoverRow } from '../team-scene/team-scene-hit'

/** The live count of helpers (subagents) inside a member's session; nothing once they stop. */
function HelpersMark({ paneKey }: { paneKey: string }): React.JSX.Element | null {
  const subagents = useAppStore((state) => state.agentStatusByPaneKey[paneKey]?.subagents)
  const { running } = teamHelpersOf(subagents)
  if (running === 0) {
    return null
  }
  return (
    <span
      data-team-helpers=""
      className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
    >
      <LoaderCircle
        data-team-helpers-spinner=""
        className="size-3 shrink-0 motion-safe:animate-spin"
        aria-hidden="true"
      />
      {teamHelpersCountText(running)}
    </span>
  )
}

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
        // Why wrap: a routed model (`Sonnet 5.5 → Opus 5.5 · high`) is wider than a 320 card.
        <code data-team-model="" className="min-w-0 break-words font-mono">
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
  // Why both ways: the scene lights this row's character, and hovering the row lights it there.
  const { lit, rowProps } = useTeamSceneHoverRow(card.paneKey)
  const shownName = showName ? card.name : (card.ticket?.identifier ?? card.name)
  // Why the pane: only its terminal can answer a prompt there, and the Inbox does not hold it (ORCA-1231).
  const inPane = card.ask?.kind === 'permission'
  const answer = !card.needsYou ? null : inPane ? (
    <Button size="xs" onClick={() => void openTeamSession(card, shownName)}>
      {translate('teamPanel.card.answerInTerminal', 'Answer in its terminal')}
    </Button>
  ) : card.ask !== null ? (
    <Button size="xs" onClick={() => selectTab('inbox')}>
      {translate('teamPanel.card.answerInInbox', 'Answer in Inbox')}
    </Button>
  ) : null
  const hostWorktreeMissing = useAppStore((state) =>
    teamHostWorktreeMissing(card, state.getKnownWorktreeById)
  )
  return (
    <article
      data-team-card="member"
      data-pane-key={card.paneKey}
      {...rowProps}
      // Why one surface: V30's .card.sel and .more read as one card, not loose text under a row.
      className={cn(
        'relative',
        expanded &&
          'mx-2 my-1 overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-accent'
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          // Why pr-9: room for the terminal icon, a sibling drawn over the row's top-right corner.
          'flex w-full min-w-0 items-start gap-2.5 py-2 pr-9 text-left hover:bg-sidebar-accent',
          // Why indented: V28's Plain and Display looks set members under the lead (ORCA-1094).
          showName ? 'pl-3' : 'pl-5',
          (expanded || lit) && 'bg-sidebar-accent'
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
              className="ml-auto shrink-0 text-right text-[11px] text-muted-foreground"
            >
              <TeamHostName host={card.host} />
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {showName ? <TeamStatusMark status={card.status} /> : null}
            {/* Why: the line names what the tone shows; the question itself is only in Inbox. */}
            <span
              className={cn(
                card.needsYou ? 'line-clamp-2 break-words text-status-attention' : 'truncate',
                !card.needsYou && teamIdleCiOf(card) === 'failure' && 'text-status-attention'
              )}
            >
              {card.needsYou && card.ask !== null
                ? teamAskText(card.ask)
                : teamMemberLiveText(card)}
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
          <HelpersMark paneKey={card.paneKey} />
        </span>
      </button>
      <span className="absolute right-2 top-2">
        <TeamOpenTerminalButton session={card} name={shownName} />
      </span>
      {answer && !expanded ? <div className="px-3 pb-2">{answer}</div> : null}
      {expanded ? (
        <TeamMemberCardDetail
          card={card}
          now={now}
          answer={answer}
          hostWorktreeMissing={hostWorktreeMissing}
        />
      ) : null}
    </article>
  )
}
