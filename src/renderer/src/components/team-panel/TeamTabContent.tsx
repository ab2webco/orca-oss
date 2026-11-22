import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { TeamPanelLook } from './use-team-panel-look'
import type { TeamAdvisorRow, TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { TeamAdvisorLine } from './TeamAdvisorLine'
import { TeamCardFace } from './TeamCardFace'
import { cn } from '@/lib/utils'
import { useTeamSceneHoverRow } from '../team-scene/team-scene-hit'
import { TeamMemberCardRow } from './TeamMemberCardRow'
import { TeamLeadCardRow } from './TeamLeadCardRow'
import { TeamReadNotice } from './team-panel-read-error'
import type { SelectTeamPanelTab } from './team-panel-tab-definition'
import { TeamArcadeSection, type TeamArcadeActions } from './TeamArcadeSection'

// Why not its paneKey: the card's open state must hold even before the lead's pane is known.
const LEAD_KEY = 'lead'

/** Why here: core names its advisor only in the files core-vendor-adapters.txt lists. */
export const teamAdvisorSourceText = (): string => translate('teamPanel.advisor.source', 'Jev')

// Why no model line: V28's row has none, and Jev's sentence already names the model it chose.
function AdvisorCardRow({
  advisor,
  showName
}: {
  advisor: TeamAdvisorRow
  showName: boolean
}): React.JSX.Element {
  const name = translate('teamPanel.advisor.name', 'Wizard')
  const { lit, rowProps } = useTeamSceneHoverRow('advisor')
  return (
    <article
      data-team-card="advisor"
      {...rowProps}
      className={cn(
        'flex items-start gap-2.5 border-b border-border px-3 py-2',
        lit && 'bg-sidebar-accent'
      )}
    >
      {showName ? (
        <TeamCardFace who={{ role: 'advisor', key: 'advisor', characterKey: null, name }} />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
          {showName ? <span className="truncate text-[13px] font-medium">{name}</span> : null}
          <code className="font-mono text-[11.5px] text-muted-foreground">
            {translate('teamPanel.advisor.label', 'Advisor')}
          </code>
          <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
            {teamAdvisorSourceText()}
          </span>
        </span>
        {/* Why it wraps: on a narrow stage the line has no bubble, so the card shows it (ORCA-1139). */}
        {advisor.line ? <TeamAdvisorLine line={advisor.line} /> : null}
      </span>
    </article>
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
  const toggle = (key: string): void => setExpanded((open) => (open === key ? null : key))
  const game = look === 'game'
  return (
    <div className="flex flex-col pb-3">
      {model.stopped ? (
        <p className="px-3 py-1.5 text-xs font-medium text-status-attention">
          {(model.stopped.membersRunning ?? 0) > 0
            ? translate('teamPanel.stopped.paused', 'Launches and pushes paused')
            : model.stopped.by
              ? translate('teamPanel.stopped.by', 'Stopped by {{by}}', { by: model.stopped.by })
              : translate('teamPanel.stopped.plain', 'Stopped')}
        </p>
      ) : null}
      {game && model.arcade && arcadeActions ? (
        <TeamArcadeSection arcade={model.arcade} actions={arcadeActions} />
      ) : null}
      <TeamLeadCardRow
        lead={model.lead}
        showName={game}
        memberCount={model.members.length}
        expanded={expanded === LEAD_KEY}
        onToggle={() => toggle(LEAD_KEY)}
        selectTab={selectTab}
      />
      {model.advisor ? <AdvisorCardRow advisor={model.advisor} showName={game} /> : null}
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
            onToggle={() => toggle(card.paneKey)}
            selectTab={selectTab}
            now={now}
          />
        ))
      )}
    </div>
  )
}
