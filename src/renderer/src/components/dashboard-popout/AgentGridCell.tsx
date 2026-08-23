import { memo } from 'react'
import { Hammer, Inbox } from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import { GitBranch } from 'lucide-react'
import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import { agentGridStateLabel } from './agent-grid-buckets'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { AgentTerminalTailReading } from '../../../../shared/agent-terminal-tail'
import type { AgentGridCellModel } from './agent-grid-model'
import { AgentGridCellTerminalTail } from './AgentGridCellTerminalTail'

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

export const AgentGridCell = memo(function AgentGridCell({
  cell,
  tail,
  now,
  onReveal
}: {
  cell: AgentGridCellModel
  tail: AgentTerminalTailReading | undefined
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
        'flex h-full w-full min-w-0 flex-col gap-1.5 overflow-hidden rounded-md border bg-card p-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
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
        {/* The dot alone reads as decoration at cell size; the word is the state. */}
        <span
          className={cn(
            'shrink-0 font-medium',
            needsAttention ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          {agentGridStateLabel(cell.dotState, card.unseen)}
        </span>
        <span aria-hidden>·</span>
        <GitBranch className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{card.worktreeName}</span>
        <span aria-hidden="true">·</span>
        {/* No agent icon here: the title row already carries it. */}
        <span className="shrink-0">{formatAgentTypeLabel(card.agentType)}</span>
        {cell.pendingToolName ? (
          <span className="ml-auto flex min-w-0 shrink items-center gap-0.5 text-foreground/80">
            <Hammer className="size-3 shrink-0" />
            <span className="truncate font-mono">{cell.pendingToolName}</span>
          </span>
        ) : null}
        {cell.queuedInput > 0 ? (
          <span
            className={cn('flex shrink-0 items-center gap-0.5', cell.pendingToolName ? '' : 'ml-auto')}
          >
            <Inbox className="size-3" />
            {cell.queuedInput}
          </span>
        ) : null}
      </div>
      <AgentGridCellTerminalTail cell={cell} tail={tail} />
    </button>
  )
})
