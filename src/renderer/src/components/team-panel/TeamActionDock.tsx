import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { AgentWorkingSpinner } from '@/components/AgentWorkingSpinner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { teamDockActionsOf, type TeamAction } from '../../../../shared/team-panel-actions'
import { TeamActionIcon } from './team-action-icons'
import { teamActionHint, teamActionLabel, teamActionOffText } from './team-action-words'

/** The lead pane's live hook status: what ends a run and carries its reply. */
export type TeamLeadTurn = { state: string; stateStartedAt: number; reply: string | null }

export type TeamActionDockProps = {
  actions: TeamAction[]
  memberCount: number
  /** Null when this window cannot see the lead's status; a run then shows no result line. */
  lead: TeamLeadTurn | null
  onRun: (action: TeamAction) => Promise<boolean>
  onOpenLead: () => void
}

// Why 9 s: V30 keeps the result line that long, then the row stands alone again.
const RECEIPT_MS = 9000

/** Leading chips that fit on the one line; the rest stay laid out but invisible, for the next measure. */
function useChipsThatFit(): [(node: HTMLDivElement | null) => void, number] {
  // Why state, not a ref: Stop's confirmation unmounts the row, and the observer must follow the new one.
  const [row, setRow] = useState<HTMLDivElement | null>(null)
  const [fit, setFit] = useState(Number.POSITIVE_INFINITY)
  const measure = useCallback((): void => {
    if (!row) {
      return
    }
    const edge = row.getBoundingClientRect().right + 1
    const chips = [...row.children]
    const outside = chips.findIndex((chip) => chip.getBoundingClientRect().right > edge)
    setFit(outside === -1 ? chips.length : Math.max(1, outside))
  }, [row])
  // Why every render: a count, label or language changes chip widths without resizing the row.
  useLayoutEffect(measure)
  useEffect(() => {
    if (!row) {
      return
    }
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [row, measure])
  return [setRow, fit]
}

export function TeamActionDock({
  actions,
  memberCount,
  lead,
  onRun,
  onOpenLead
}: TeamActionDockProps): React.JSX.Element | null {
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState<{ action: TeamAction; sentAt: number } | null>(null)
  const [receipt, setReceipt] = useState<{ label: string; text: string } | null>(null)
  const chips = teamDockActionsOf(actions, null)
  const [row, fit] = useChipsThatFit()
  const stop = actions.find((one) => one.orca === 'stop') ?? null

  // Why stateStartedAt: a state that began after the send is the lead's answer to it.
  // Why during render: React's way to adjust state from a prop, with no stale frame between.
  if (running && lead && lead.state !== 'working' && lead.stateStartedAt > running.sentAt) {
    const text = lead.reply?.split('\n')[0]?.trim() || translate('teamPanel.actions.done', 'Done.')
    setReceipt({ label: teamActionLabel(running.action), text })
    setRunning(null)
  }
  useEffect(() => {
    if (!receipt) {
      return
    }
    const timer = setTimeout(() => setReceipt(null), RECEIPT_MS)
    return () => clearTimeout(timer)
  }, [receipt])

  if (actions.length === 0) {
    return null
  }
  const run = (action: TeamAction): void => {
    const sentAt = Date.now()
    setConfirming(false)
    setReceipt(null)
    if (lead) {
      setRunning({ action, sentAt })
    }
    void onRun(action).then((sent) => {
      if (!sent) {
        setRunning(null)
      }
    })
  }
  const busy = running !== null
  const stopLabel = stop?.off
    ? teamActionOffText(stop.off)
    : translate('teamPanel.actions.stopAll', 'Stop every member')
  return (
    <section
      data-team-action-dock=""
      aria-label={translate('teamPanel.actions.label', 'Actions')}
      className="relative flex flex-none flex-col gap-1.5 border-t border-border bg-sidebar px-2.5 py-2"
    >
      {confirming && stop ? (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="min-w-0 flex-[1_1_140px]">
            {translate(
              'teamPanel.actions.stopConfirm',
              'Stop all {{count}} members? They stay stopped until you push them.',
              { count: memberCount }
            )}
          </span>
          <Button variant="destructive" size="sm" className="h-7" onClick={() => run(stop)}>
            {teamActionLabel(stop)}
          </Button>
          <Button variant="ghost" size="sm" className="h-7" onClick={() => setConfirming(false)}>
            {translate('teamPanel.actions.cancel', 'Cancel')}
          </Button>
        </div>
      ) : (
        <>
          {receipt ? (
            <div
              role="status"
              aria-live="polite"
              className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
            >
              <span aria-hidden className="text-status-success">
                ✓
              </span>
              <span className="min-w-0 flex-1 truncate">{`${receipt.label}: ${receipt.text}`}</span>
              <button
                type="button"
                className="flex-none underline underline-offset-2 hover:text-foreground"
                onClick={onOpenLead}
              >
                {translate('teamPanel.actions.seeReply', 'See reply')}
              </button>
            </div>
          ) : null}
          <div className="flex min-w-0 items-center gap-1">
            <div ref={row} className="flex min-w-0 flex-1 gap-1 overflow-hidden">
              {chips.map((action, at) => {
                const now = action.now !== null
                const own = running?.action.id === action.id
                const hidden = at >= fit
                return (
                  <button
                    key={action.id}
                    type="button"
                    data-team-action={action.id}
                    title={action.off ? teamActionOffText(action.off) : teamActionHint(action)}
                    aria-label={
                      now && !own
                        ? `${teamActionLabel(action)}, ${teamActionHint(action)}`
                        : undefined
                    }
                    disabled={(busy && !own) || action.off !== null}
                    aria-hidden={hidden || undefined}
                    tabIndex={hidden ? -1 : undefined}
                    onClick={() => (own ? undefined : run(action))}
                    className={cn(
                      'inline-flex h-7 flex-none items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent',
                      now && 'bg-muted text-foreground hover:bg-accent',
                      hidden && 'invisible'
                    )}
                  >
                    {own ? (
                      <AgentWorkingSpinner className="mx-0.5 size-[9px]" />
                    ) : (
                      <TeamActionIcon
                        icon={action.icon}
                        className={now ? 'text-muted-foreground' : 'text-muted-foreground/70'}
                      />
                    )}
                    <span>{teamActionLabel(action)}</span>
                    {now && !own ? (
                      <b className="text-[11px] font-medium tabular-nums text-muted-foreground">
                        {action.now?.count}
                      </b>
                    ) : null}
                  </button>
                )
              })}
            </div>
            {stop ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-7 text-muted-foreground hover:text-status-attention"
                    aria-label={stopLabel}
                    disabled={stop.off !== null || busy}
                    onClick={() => setConfirming(true)}
                  >
                    <TeamActionIcon icon="stop" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={4}>
                  {stopLabel}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
