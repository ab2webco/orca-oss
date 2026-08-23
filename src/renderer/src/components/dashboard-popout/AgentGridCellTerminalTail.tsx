import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { TriangleAlert } from 'lucide-react'
import type { AgentSessionLogUnreadReason } from '../../../../shared/agent-session-log-state'
import type { AgentTerminalTailReading } from '../../../../shared/agent-terminal-tail'
import type { AgentGridCellModel } from './agent-grid-model'

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

/** Why a visible reason and not a blank box: "cannot read this" and "nothing to
 *  show" must never look identical (ORCA-191). */
function CellNotice({ text }: { text: string }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <p
          className="flex min-h-0 flex-1 items-end gap-1 text-[12px] text-muted-foreground/70 italic"
          data-activity-source="none"
        >
          <TriangleAlert className="size-3 shrink-0" />
          <span className="truncate">{text}</span>
        </p>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

/** The session-log projection stays the cell's fallback, so a pane whose
 *  terminal Orca cannot read still says what the transcript knows. */
function SessionLogFallback({ cell }: { cell: AgentGridCellModel }): React.JSX.Element {
  if (cell.activityText) {
    return (
      <p
        className="line-clamp-3 min-h-0 flex-1 text-[12px] leading-snug text-muted-foreground"
        data-activity-source={cell.activitySource}
      >
        {cell.activityText}
      </p>
    )
  }
  return (
    <CellNotice
      text={
        cell.textBeyondScan
          ? translate('dashboardPopout.grid.unread.textBeyondScan', 'Last message beyond the scan')
          : cell.unreadReason
            ? unreadReasonLabel(cell.unreadReason)
            : translate('dashboardPopout.grid.noMessageYet', 'No message yet')
      }
    />
  )
}

/**
 * The live terminal of one agent, as text.
 *
 * Text and not an xterm: a cell is ~320px wide, and a real terminal must be
 * built at the pty's own grid (80-240 cols) then scaled to fit, which is
 * unreadable at that size. Bottom-anchored so the newest line is the one that
 * survives a short box (ORCA-234).
 */
export function AgentGridCellTerminalTail({
  cell,
  tail
}: {
  cell: AgentGridCellModel
  /** Undefined until the first poll lands. */
  tail: AgentTerminalTailReading | undefined
}): React.JSX.Element {
  if (!cell.card.ptyId) {
    return (
      <CellNotice
        text={translate(
          'dashboardPopout.terminal.closed',
          "No live terminal — this agent's pane has closed."
        )}
      />
    )
  }
  if (tail?.read === false) {
    return (
      <CellNotice
        text={translate('dashboardPopout.grid.terminalUnreadable', 'Terminal output unavailable')}
      />
    )
  }
  if (!tail || tail.lines.length === 0) {
    return <SessionLogFallback cell={cell} />
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden rounded-sm bg-muted/50 px-1.5 py-1">
      {/* One text node, not a row per line: terminal rows have no identity of
          their own, and `pre` already clips what the cell cannot fit. */}
      <pre
        data-terminal-tail={cell.card.ptyId}
        className="overflow-hidden font-mono text-[10px] leading-[1.35] text-foreground/80"
      >
        {tail.lines.join('\n')}
      </pre>
    </div>
  )
}
