import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { StatusDot } from '@/components/StatusDot'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import type { TeamActivityRow, TeamPanelSoloModel } from '../../../../shared/team-panel-model-types'
import {
  teamConditionText,
  teamHostText,
  teamSoloLiveText,
  teamModelText,
  teamSessionStateText,
  teamStatusTone
} from './team-card-text'
import { TeamActivityDetail } from './TeamActivityDetail'
import { openTeamSession } from './team-session-open'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'

const AGE_TICK_MS = 30_000

/** The row's line: the question, the live tool, else the last reply or the prompt. */
export function teamActivityLine(row: TeamActivityRow): string {
  if (row.liveAction) {
    return teamSoloLiveText(row.liveAction, row.condition)
  }
  if (row.condition === 'done' && row.lastMessage) {
    return row.lastMessage
  }
  return row.prompt ?? teamConditionText(row.condition)
}

function OtherSession({ row, now }: { row: TeamActivityRow; now: number }): React.JSX.Element {
  return (
    <button
      type="button"
      data-team-activity="other"
      data-pane-key={row.paneKey}
      onClick={() => void openTeamSession(row, row.worktreeName)}
      className="flex w-full min-w-0 flex-col gap-0.5 border-t border-border px-3 py-2 text-left hover:bg-sidebar-accent"
    >
      <span className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
        <span className="max-w-[70%] shrink-0 truncate text-[13px] font-medium">
          {row.worktreeName}
        </span>
        {row.repoName ? (
          <span className="truncate text-xs text-muted-foreground">{row.repoName}</span>
        ) : null}
        <code className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
          {teamHostText(row.host)}
        </code>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <StatusDot tone={teamStatusTone(row.status)} />
        <span className={cn('truncate', row.status === 'attention' && 'text-status-attention')}>
          {teamActivityLine(row)}
        </span>
      </span>
      <span data-team-activity-meta="" className="text-xs text-muted-foreground">
        {[
          teamModelText(row.model),
          teamSessionStateText(row.condition),
          row.since !== null ? formatUiRelativeTime(row.since - now) : null
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </button>
  )
}

export function TeamPanelActivityTab({
  value
}: TeamPanelTabBodyProps<TeamPanelSoloModel>): React.JSX.Element | null {
  const cacheTtlMs = useAppStore((s) => s.settings?.promptCacheTtlMs ?? 0)
  // Why: Jev reaches a pane only through its plugin; with the plugin system off there is none.
  const pluginsOn = useAppStore((s) => s.settings?.pluginSystemEnabled === true)
  // Why: ages are minute-grained; a 30 s tick keeps them current without per-frame renders.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), AGE_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
  const selected = value.rows.find((row) => row.paneKey === value.selectedPaneKey) ?? value.rows[0]
  if (!selected) {
    return null
  }
  const others = value.rows.filter((row) => row !== selected)
  return (
    <div data-team-activity-tab="">
      <TeamActivityDetail
        row={pluginsOn ? selected : { ...selected, advisor: null }}
        now={now}
        cacheTtlMs={cacheTtlMs}
      />
      {others.length > 0 ? (
        <>
          <h4 className="m-0 border-t border-border px-3 pb-1.5 pt-2.5 text-[11.5px] font-medium text-muted-foreground/80">
            {translate('teamPanel.activity.otherSessions', 'Other sessions')}
          </h4>
          {others.map((row) => (
            <OtherSession key={row.paneKey} row={row} now={now} />
          ))}
        </>
      ) : null}
    </div>
  )
}
