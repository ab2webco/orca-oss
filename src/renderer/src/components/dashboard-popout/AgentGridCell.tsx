import { memo } from 'react'
import { Hammer, Inbox, TriangleAlert } from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { AgentSessionLogUnreadReason } from '../../../../shared/agent-session-log-state'
import type { AgentGridCellModel } from './agent-grid-model'

/** Coarse "N ago" — the grid is scanned, not read. */
function formatAgo(atMs: number, now: number): string {
  if (!Number.isFinite(atMs) || atMs <= 0) {
    return ''
  }
  const minutes = Math.floor(Math.max(0, now - atMs) / 60_000)
  if (minutes < 1) {
    return translate('dashboardPopout.card.time.justNow', 'just now')
  }
  if (minutes < 60) {
    return translate('dashboardPopout.card.time.minutes', '{{count}}m', { count: minutes })
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24
    ? translate('dashboardPopout.card.time.hours', '{{count}}h', { count: hours })
    : translate('dashboardPopout.card.time.days', '{{count}}d', { count: Math.floor(hours / 24) })
}

function unreadReasonLabel(reason: AgentSessionLogUnreadReason): string {
  switch (reason) {
    case 'agent-unsupported':
      return translate('dashboardPopout.grid.unread.agentUnsupported', 'No readable session log')
    case 'agent-session-unknown':
      return translate('dashboardPopout.grid.unread.sessionUnknown', 'Session not identified yet')
    case 'session-log-missing':
      return translate('dashboardPopout.grid.unread.logMissing', 'Session log not found')
    case 'session-log-unreadable':
      return translate('dashboardPopout.grid.unread.logUnreadable', 'Session log unreadable')
    case 'turn-boundary-beyond-scan':
      return translate('dashboardPopout.grid.unread.beyondScan', 'Turn start beyond the scan')
  }
}

export const AgentGridCell = memo(function AgentGridCell({
  cell,
  now,
  onReveal
}: {
  cell: AgentGridCellModel
  now: number
  onReveal: (cell: AgentGridCellModel) => void
}): React.JSX.Element {
  const { card } = cell
  const title = card.conversationName || card.worktreeName
  const ago = formatAgo(cell.activeSinceMs, now)
  const needsAttention = cell.dotState === 'blocked' || cell.dotState === 'waiting'
  return (
    <button
      type="button"
      onClick={() => onReveal(cell)}
      data-pane-key={card.paneKey}
      data-dot-state={cell.dotState}
      aria-label={`${title} — ${agentStateLabel(cell.dotState)}`}
      className={cn(
        'flex h-full min-h-[104px] w-full flex-col gap-1.5 rounded-md border bg-card p-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        needsAttention ? 'border-ring' : 'border-border'
      )}
    >
      <div className="flex items-center gap-1.5">
        <AgentStateDot state={cell.dotState} size="sm" />
        <AgentIcon agent={agentTypeToIconAgent(card.agentType)} size={14} />
        <span className="truncate text-[13px] font-medium">{title}</span>
        {ago ? (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{ago}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="truncate">{card.worktreeName}</span>
        <span aria-hidden="true">·</span>
        <span className="shrink-0">{formatAgentTypeLabel(card.agentType)}</span>
        {cell.queuedInput > 0 ? (
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            <Inbox className="size-3" />
            {cell.queuedInput}
          </span>
        ) : null}
      </div>
      {cell.pendingToolName ? (
        <div className="flex items-center gap-1 text-[11px] text-foreground/80">
          <Hammer className="size-3 shrink-0" />
          <span className="truncate font-mono">{cell.pendingToolName}</span>
        </div>
      ) : null}
      <AgentGridCellBody cell={cell} />
    </button>
  )
})

function AgentGridCellBody({ cell }: { cell: AgentGridCellModel }): React.JSX.Element {
  if (cell.activityText) {
    return (
      <p
        className="line-clamp-3 text-[12px] leading-snug text-muted-foreground"
        data-activity-source={cell.activitySource}
      >
        {cell.activityText}
      </p>
    )
  }
  // Why a visible reason and not a blank cell: "cannot read this agent" and
  // "this agent has said nothing" must never look identical (ORCA-191).
  const reason = cell.textBeyondScan
    ? translate('dashboardPopout.grid.unread.textBeyondScan', 'Last message beyond the scan')
    : cell.unreadReason
      ? unreadReasonLabel(cell.unreadReason)
      : translate('dashboardPopout.grid.noMessageYet', 'No message yet')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <p
          className="flex items-center gap-1 text-[12px] text-muted-foreground/70 italic"
          data-activity-source="none"
        >
          <TriangleAlert className="size-3 shrink-0" />
          <span className="truncate">{reason}</span>
        </p>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {reason}
      </TooltipContent>
    </Tooltip>
  )
}
