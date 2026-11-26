import { useContext } from 'react'
import { Crown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { TeamLeadCard } from '../../../../shared/team-panel-model-types'
import { teamConditionText, teamLiveText, teamModelText } from './team-card-text'
import { teamLeadCardLine } from './team-card-line'
import { TeamHostName } from './TeamHostName'
import { TeamStatusMark } from './TeamStatusMark'
import { TeamCardFace } from './TeamCardFace'
import { MetaLine } from './TeamMemberCardRow'
import { BranchText, TeamFactsGrid, type TeamFact } from './TeamMemberCardDetail'
import { TeamOpenTerminalButton } from './TeamOpenTerminalButton'
import type { SelectTeamPanelTab } from './team-panel-tab-definition'
import { useTeamLeadPrompt } from './use-team-lead-prompt'
import { TeamSceneLeadLineContext } from '../team-scene/team-scene-lead-line-context'
import { TEAM_ROW_LIT_CLASS, useTeamSceneHoverRow } from '../team-scene/team-scene-hit'

function coordinatesText(count: number): string {
  return count === 1
    ? translate('teamPanel.lead.coordinatesOne', 'Coordinates 1 agent')
    : translate('teamPanel.lead.coordinatesMany', 'Coordinates {{count}} agents', { count })
}

// Why only these: each is already in the lead's model, so the open card adds no wire field.
function leadFactsOf(lead: TeamLeadCard): TeamFact[] {
  const waitingOn = lead.waitingOn ?? 0
  const facts: (TeamFact | null)[] = [
    {
      key: 'status',
      label: translate('teamPanel.lead.detail.status', 'Status'),
      value: teamConditionText(lead.condition)
    },
    lead.liveAction
      ? {
          key: 'action',
          label: translate('teamPanel.lead.detail.action', 'Now'),
          value: teamLiveText(lead.liveAction, lead.condition),
          wraps: true as const
        }
      : null,
    waitingOn > 0
      ? {
          key: 'waitingOn',
          label: translate('teamPanel.lead.detail.waitingOn', 'Waiting on'),
          value:
            waitingOn === 1
              ? translate('teamPanel.lead.detail.agents_one', '{{count}} agent', { count: 1 })
              : translate('teamPanel.lead.detail.agents_other', '{{count}} agents', {
                  count: waitingOn
                })
        }
      : null,
    lead.ownerAsk
      ? {
          key: 'question',
          label: translate('teamPanel.lead.detail.question', 'Question'),
          value: lead.ownerAsk.ticket
            ? translate('teamPanel.lead.detail.questionOn', 'Open, on {{ticket}}', {
                ticket: lead.ownerAsk.ticket
              })
            : translate('teamPanel.lead.detail.questionOpen', 'Open')
        }
      : null,
    {
      key: 'host',
      label: translate('teamPanel.lead.detail.host', 'Host'),
      value: <TeamHostName host={lead.host} />
    },
    lead.model
      ? {
          key: 'model',
          label: translate('teamPanel.lead.detail.model', 'Model'),
          value: <code className="font-mono text-[11.5px]">{lead.model.label}</code>
        }
      : null,
    lead.model?.effort
      ? {
          key: 'effort',
          label: translate('teamPanel.lead.detail.effort', 'Effort'),
          value: lead.model.effort
        }
      : null,
    lead.branch
      ? {
          key: 'branch',
          label: translate('teamPanel.card.detail.branch', 'Branch'),
          value: <BranchText branch={lead.branch} />
        }
      : null
  ]
  return facts.filter((fact): fact is TeamFact => fact !== null)
}

export function TeamLeadCardRow({
  lead,
  showName,
  memberCount,
  expanded,
  onToggle,
  selectTab
}: {
  lead: TeamLeadCard
  showName: boolean
  memberCount: number
  expanded: boolean
  onToggle: () => void
  selectTab: SelectTeamPanelTab
}): React.JSX.Element {
  const sceneLine = useContext(TeamSceneLeadLineContext)
  const sendToLead = useTeamLeadPrompt()
  const setupLabel = translate('teamPanel.lead.nameSetup', 'Name your lead')
  // Why 'lead': the 3D scenes key the lead's figure so, as its card face does.
  const { lit, rowProps } = useTeamSceneHoverRow('lead')
  const line = teamLeadCardLine(lead)
  return (
    <article
      data-team-card="lead"
      {...rowProps}
      className={cn(
        'relative',
        expanded
          ? 'mx-2 my-1 overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-accent'
          : 'border-b border-border'
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          'flex w-full min-w-0 items-start gap-2.5 py-2 pl-3 pr-9 text-left hover:bg-sidebar-accent',
          expanded && 'bg-sidebar-accent',
          lit && TEAM_ROW_LIT_CLASS
        )}
      >
        {showName ? (
          <TeamCardFace
            who={{ role: 'lead', key: 'lead', characterKey: lead.characterKey, name: lead.name }}
          />
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 whitespace-nowrap">
            {/* Why: an unnamed lead is "Lead", which the crown badge already says. */}
            {showName && !lead.isNameDefault ? (
              <span data-team-name="" className="min-w-0 truncate text-[13px] font-medium">
                {lead.name}
              </span>
            ) : null}
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 text-[11px] font-medium leading-4 text-foreground">
              <Crown data-crown="" className="size-3" aria-hidden="true" />
              {translate('teamPanel.lead.badge', 'Lead')}
            </span>
            <span
              data-team-host=""
              className="ml-auto shrink-0 text-right text-[11px] text-muted-foreground"
            >
              <TeamHostName host={lead.host} />
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <TeamStatusMark status={lead.status} />
            <span
              className={
                line.attention ? 'line-clamp-2 break-words text-status-attention' : 'truncate'
              }
            >
              {line.text}
            </span>
          </span>
          {sceneLine ? (
            <span
              data-team-lead-line=""
              className="whitespace-pre-line text-xs text-muted-foreground [overflow-wrap:anywhere]"
            >
              {sceneLine}
            </span>
          ) : null}
          <MetaLine model={teamModelText(lead.model)} parts={[coordinatesText(memberCount)]} />
        </span>
      </button>
      <span className="absolute right-2 top-2">
        <TeamOpenTerminalButton session={lead} name={lead.name} />
      </span>
      {lead.isNameDefault && sendToLead ? (
        <div
          data-team-lead-unnamed=""
          className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2 text-xs text-muted-foreground"
        >
          <span className="min-w-0 flex-1 basis-32">
            {translate(
              'teamPanel.lead.unnamed',
              'Your lead has no name yet. The setup asks for it.'
            )}
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={() => void sendToLead('setup', '/orca-game:setup', setupLabel)}
          >
            {setupLabel}
          </Button>
        </div>
      ) : null}
      {expanded ? (
        <div
          data-team-card-detail=""
          className="@container flex min-w-0 flex-col gap-2.5 px-3 pb-3 pt-1 text-xs"
        >
          {lead.ownerAsk ? (
            <Button size="xs" className="self-start" onClick={() => selectTab('inbox')}>
              {translate('teamPanel.card.answerInInbox', 'Answer in Inbox')}
            </Button>
          ) : null}
          <TeamFactsGrid facts={leadFactsOf(lead)} />
        </div>
      ) : null}
    </article>
  )
}
