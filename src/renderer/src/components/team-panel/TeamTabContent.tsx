import { useState } from 'react'
import { Crown } from 'lucide-react'
import { StatusDot } from '@/components/StatusDot'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { TeamPanelLook } from './use-team-panel-look'
import type {
  TeamAdvisorRow,
  TeamLeadCard,
  TeamPanelGameModel
} from '../../../../shared/team-panel-model-types'
import { teamHostText, teamLiveText, teamModelText, teamStatusTone } from './team-card-text'
import { MetaLine, TeamMemberCardRow } from './TeamMemberCardRow'
import { openTeamSession } from './team-session-open'
import { TeamReadNotice } from './team-panel-read-error'
import type { SelectTeamPanelTab } from './team-panel-tab-definition'
import { TeamArcadeSection, type TeamArcadeActions } from './TeamArcadeSection'

/** Why here: core names its advisor only in the files core-vendor-adapters.txt lists. */
export const teamAdvisorSourceText = (): string => translate('teamPanel.advisor.source', 'Jev')

function coordinatesText(count: number): string {
  return count === 1
    ? translate('teamPanel.lead.coordinatesOne', 'Coordinates 1 agent')
    : translate('teamPanel.lead.coordinatesMany', 'Coordinates {{count}} agents', { count })
}

function LeadCardRow({
  lead,
  showName,
  memberCount
}: {
  lead: TeamLeadCard
  showName: boolean
  memberCount: number
}): React.JSX.Element {
  return (
    <article data-team-card="lead" className="border-b border-border">
      <button
        type="button"
        onClick={() => void openTeamSession(lead, lead.name)}
        className="flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left hover:bg-sidebar-accent"
      >
        <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
          {showName ? <span className="truncate text-[13px] font-medium">{lead.name}</span> : null}
          <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 text-[11px] font-medium leading-4 text-foreground">
            <Crown data-crown="" className="size-3" aria-hidden="true" />
            {translate('teamPanel.lead.badge', 'Lead')}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
            {teamHostText(lead.host)}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot tone={teamStatusTone(lead.status)} />
          <span className="truncate">{teamLiveText(lead.liveAction, lead.condition)}</span>
        </span>
        <MetaLine parts={[teamModelText(lead.model), coordinatesText(memberCount)]} />
      </button>
    </article>
  )
}

function AdvisorCardRow({ advisor }: { advisor: TeamAdvisorRow }): React.JSX.Element {
  const model = advisor.model
    ? advisor.effort
      ? `${advisor.model} · ${advisor.effort}`
      : advisor.model
    : null
  return (
    <article
      data-team-card="advisor"
      className="flex flex-col gap-0.5 border-b border-border px-3 py-2"
    >
      <span className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
        <code className="font-mono text-[11.5px] text-muted-foreground">
          {translate('teamPanel.advisor.label', 'Advisor')}
        </code>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
          {teamAdvisorSourceText()}
        </span>
      </span>
      {advisor.line ? (
        <span className="truncate text-xs text-muted-foreground">{advisor.line}</span>
      ) : null}
      <MetaLine parts={[model]} />
    </article>
  )
}

function XpRow({ xp }: { xp: NonNullable<TeamPanelGameModel['xp']> }): React.JSX.Element {
  const ratio = xp.need > 0 ? Math.min(1, xp.into / xp.need) : 0
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs tabular-nums text-muted-foreground">
      <span>{translate('teamPanel.xp.level', 'Lv {{level}}', { level: xp.level })}</span>
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full origin-left bg-foreground/60"
          style={{ transform: `scaleX(${ratio})` }}
        />
      </span>
      <span>
        {translate('teamPanel.xp.progress', '{{into}}/{{need}} XP', {
          into: xp.into,
          need: xp.need
        })}
      </span>
    </div>
  )
}

export function TeamTabContent({
  model,
  look,
  selectTab,
  now,
  arcadeActions,
  onOpenTasks
}: {
  model: TeamPanelGameModel
  look: TeamPanelLook
  selectTab: SelectTeamPanelTab
  now: number
  /** Absent or null when the host cannot spend a play, which hides the arcade like the model's own null. */
  arcadeActions?: TeamArcadeActions | null
  onOpenTasks: () => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null)
  const game = look === 'game'
  return (
    <div className="flex flex-col pb-3">
      {game && model.xp ? <XpRow xp={model.xp} /> : null}
      {model.stopped ? (
        <p className="px-3 py-1.5 text-xs font-medium text-status-attention">
          {model.stopped.by
            ? translate('teamPanel.stopped.by', 'Stopped by {{by}}', { by: model.stopped.by })
            : translate('teamPanel.stopped.plain', 'Stopped')}
        </p>
      ) : null}
      {game && model.arcade && arcadeActions ? (
        <TeamArcadeSection arcade={model.arcade} actions={arcadeActions} />
      ) : null}
      <LeadCardRow lead={model.lead} showName={game} memberCount={model.members.length} />
      {model.advisor ? <AdvisorCardRow advisor={model.advisor} /> : null}
      <TeamReadNotice />
      {model.members.length === 0 ? (
        <div className="flex flex-col gap-1 px-3 py-6 text-xs text-muted-foreground">
          <p className="text-[13px] font-medium text-foreground">
            {translate('teamPanel.tabs.team.emptyTitle', 'No agents yet')}
          </p>
          <p>
            {translate(
              'teamPanel.tabs.team.emptyText',
              'Launch one from a ticket and it shows here.'
            )}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-team-view-tasks=""
            className="mt-1.5 self-start text-xs"
            onClick={onOpenTasks}
          >
            {translate('teamPanel.tabs.team.viewTasks', 'View tasks')}
          </Button>
        </div>
      ) : (
        model.members.map((card) => (
          <TeamMemberCardRow
            key={card.paneKey}
            card={card}
            showName={game}
            expanded={expanded === card.paneKey}
            onToggle={() => setExpanded((open) => (open === card.paneKey ? null : card.paneKey))}
            selectTab={selectTab}
            now={now}
          />
        ))
      )}
    </div>
  )
}
