import React, { useCallback } from 'react'
import { GitBranch, GitPullRequest } from 'lucide-react'
import { cn } from '@/lib/utils'
import { statusToneTextClass } from '@/components/status-tone'
import { TeamStatusMark } from '@/components/team-panel/TeamStatusMark'
import { statusToneOfCi, teamAgeText } from '@/components/team-panel/team-card-text'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { DashboardAgentRowTrailingControls } from '@/components/dashboard/DashboardAgentRowTrailingControls'
import type { TeamPullRequest } from '../../../../shared/team-panel-model-types'
import { sidebarSoloActivityRow } from './sidebar-solo-row'
import type { SidebarTeamRowLines } from './sidebar-team-row-lines'

export type SidebarSoloRowProps = {
  agent: DashboardAgentRow
  name: string
  /** The worktree's PR when Card display shows it; null keeps the branch icon. */
  pr: Pick<TeamPullRequest, 'state' | 'ci'> | null
  now: number
  lines: SidebarTeamRowLines
  onActivate: (tabId: string, paneKey: string) => void
  onDismiss: (paneKey: string) => void
  sendTargetStatus?: 'eligible' | 'disabled' | 'sending'
  sendTargetDisabledReason?: string
  onSendTargetClick?: (paneKey: string) => void
}

const noop = (): void => {}

/** V30's soloRow: the inline list's one agent drawn as the worktree's own row, with its actions. */
export const SidebarSoloRow = React.memo(function SidebarSoloRow({
  agent,
  name,
  pr,
  now,
  lines,
  onActivate,
  onDismiss,
  sendTargetStatus,
  sendTargetDisabledReason,
  onSendTargetClick
}: SidebarSoloRowProps): React.JSX.Element {
  const status = sidebarSoloActivityRow(agent.entry).status
  const ciTone = pr ? statusToneOfCi(pr) : null
  const KindIcon = pr ? GitPullRequest : GitBranch
  const paneKey = agent.paneKey
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      // Why modifiers bubble: the card owns multi-select.
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        return
      }
      event.stopPropagation()
      if (!sendTargetStatus) {
        onActivate(agent.tab.id, agent.activationPaneKey ?? paneKey)
      } else if (sendTargetStatus === 'eligible') {
        onSendTargetClick?.(paneKey)
      }
    },
    [agent, onActivate, onSendTargetClick, paneKey, sendTargetStatus]
  )
  const hasLines = Boolean(lines.activity || lines.extra)
  return (
    <div
      data-sidebar-solo-row=""
      role="treeitem"
      aria-level={1}
      data-agent-send-target={sendTargetStatus}
      title={sendTargetDisabledReason}
      onClick={handleClick}
      className={cn(
        'group/agent-row relative flex w-full min-w-0 flex-col',
        hasLines && 'pb-1',
        sendTargetStatus === 'disabled' && 'opacity-60'
      )}
    >
      <div className="relative flex h-6.5 w-full min-w-0 items-center gap-[7px] text-[12.5px]">
        <span data-team-row-part="state" className="grid w-3.5 shrink-0 place-items-center">
          <TeamStatusMark status={status} />
        </span>
        <span
          data-team-row-part="kind"
          data-kind={pr ? 'pr' : 'branch'}
          data-ci-tone={ciTone ?? undefined}
          className={cn(
            'grid shrink-0 place-items-center',
            ciTone ? statusToneTextClass(ciTone) : 'text-muted-foreground'
          )}
        >
          <KindIcon className="size-3" aria-hidden="true" />
        </span>
        <b
          data-team-row-part="name"
          className="min-w-0 flex-1 truncate font-medium text-foreground"
        >
          {name}
        </b>
        <span data-team-row-part="age" className="shrink-0 text-[11px] tabular-nums">
          <DashboardAgentRowTrailingControls
            paneKey={paneKey}
            relativeTimestamp={teamAgeText(agent.entry.stateStartedAt, now) || null}
            expanded={false}
            hideExpand
            sendTargetStatus={sendTargetStatus}
            onDismiss={onDismiss}
            onToggleExpanded={noop}
            onSendTargetClick={onSendTargetClick}
          />
        </span>
      </div>
      {/* Why pl-10: V30's act-lines start under the name, past the dot, the icon and their gaps. */}
      {lines.activity ? (
        <span
          data-team-row-part="act"
          data-asks={lines.activity.asks ? '' : undefined}
          className={cn(
            '-mt-1 truncate pl-10 text-[11.5px] leading-4',
            lines.activity.asks ? 'text-agent-question-text' : 'text-muted-foreground'
          )}
        >
          {lines.activity.text}
        </span>
      ) : null}
      {lines.extra ? (
        <span
          data-team-row-part="extra"
          className={cn(
            'truncate pl-10 text-[11.5px] leading-4 text-muted-foreground',
            !lines.activity && '-mt-1'
          )}
        >
          {lines.extra}
        </span>
      ) : null}
    </div>
  )
})
