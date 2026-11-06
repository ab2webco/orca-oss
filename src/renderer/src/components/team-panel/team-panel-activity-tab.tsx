import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { StatusDot } from '@/components/StatusDot'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import type {
  TeamActivityRow,
  TeamPanelSoloModel,
  TeamStatus
} from '../../../../shared/team-panel-model-types'
import {
  teamConditionText,
  teamHostText,
  teamLiveText,
  teamModelText,
  teamStatusTone
} from './team-card-text'
import { MetaLine } from './TeamMemberCardRow'
import { TeamActivityDetail } from './TeamActivityDetail'
import { openTeamSession } from './team-panel-open-session'
import type { TeamPanelTabBodyProps } from './team-panel-tab-definition'

const AGE_TICK_MS = 30_000

/** The row's line: the question, the live tool, else the last reply or the prompt. */
export function teamActivityLine(row: TeamActivityRow): string {
  if (row.liveAction) {
    return teamLiveText(row.liveAction, row.condition)
  }
  if (row.condition === 'done' && row.lastMessage) {
    return row.lastMessage
  }
  return row.prompt ?? teamConditionText(row.condition)
}

function countText(status: TeamStatus, count: number): string {
  const one = count === 1
  switch (status) {
    case 'attention':
      return one
        ? translate('teamPanel.activity.countNeedsYou_one', '{{count}} needs you', { count })
        : translate('teamPanel.activity.countNeedsYou_other', '{{count}} need you', { count })
    case 'working':
      return translate('teamPanel.activity.countWorking', '{{count}} working', {
        count
      })
    default:
      return one
        ? translate('teamPanel.activity.countDone_one', '{{count}} done', {
            count
          })
        : translate('teamPanel.activity.countDone_other', '{{count}} done', {
            count
          })
  }
}

const COUNTED: TeamStatus[] = ['attention', 'working', 'done']

function SessionCount({ rows }: { rows: readonly TeamActivityRow[] }): React.JSX.Element | null {
  const parts = COUNTED.map(
    (status) => [status, rows.filter((row) => row.status === status).length] as const
  )
  const shown = parts.filter(([, n]) => n > 0)
  if (shown.length === 0) {
    return null
  }
  return (
    <div
      data-team-activity-count=""
      className="flex flex-wrap gap-x-3.5 gap-y-1 px-3 pt-2.5 text-xs text-muted-foreground"
    >
      {shown.map(([status, count]) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <StatusDot tone={teamStatusTone(status)} />
          {countText(status, count)}
        </span>
      ))}
    </div>
  )
}

function OtherSession({ row, now }: { row: TeamActivityRow; now: number }): React.JSX.Element {
  return (
    <button
      type="button"
      data-team-activity="other"
      data-pane-key={row.paneKey}
      onClick={() => openTeamSession(row)}
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
      <MetaLine
        parts={[
          teamModelText(row.model),
          teamConditionText(row.condition),
          row.since !== null ? formatUiRelativeTime(row.since - now) : null
        ]}
      />
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
      {value.rows.length > 1 ? <SessionCount rows={value.rows} /> : null}
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
