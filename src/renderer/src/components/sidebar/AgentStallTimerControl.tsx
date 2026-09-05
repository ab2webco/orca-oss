import React, { useCallback, useMemo } from 'react'
import { AlarmClock, TriangleAlert } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { armAgentStallTimer } from '@/lib/agent-stall-timer-driver'
import { getAgentStallTimerAvailability } from '@/lib/agent-stall-timer-target'
import {
  AGENT_STALL_TIMER_INTERVAL_MINUTES,
  isAgentStallTimerIntervalMinutes
} from '../../../../shared/agent-stall-timer'

const OFF_VALUE = 'off'

type AgentStallTimerControlProps = {
  paneKey: string
}

/**
 * "Check if it is stuck": watches the worktree's git progress and escalates once when it
 * stops moving. Lives on the agent row so arming one is two clicks from the agent itself.
 */
export function AgentStallTimerControl({
  paneKey
}: AgentStallTimerControlProps): React.JSX.Element {
  // Optional reads: partial store states reach this during hydration and in card tests.
  const entry = useAppStore((s) => s.agentStallTimerByPaneKey?.[paneKey])
  // Selected apart and memoized: the availability object is derived, so selecting it
  // directly would hand zustand a new reference on every store update.
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const repos = useAppStore((s) => s.repos)
  const availability = useMemo(
    () => getAgentStallTimerAvailability({ tabsByWorktree, repos }, paneKey),
    [paneKey, repos, tabsByWorktree]
  )

  const handleValueChange = useCallback(
    (value: string) => {
      const minutes = Number.parseInt(value, 10)
      armAgentStallTimer(paneKey, isAgentStallTimerIntervalMinutes(minutes) ? minutes : null)
    },
    [paneKey]
  )
  const stopMouseDown = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
  }, [])

  const isStalled = entry?.status === 'stalled'
  const label = describeTriggerLabel(entry?.intervalMinutes ?? null, isStalled)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onMouseDown={stopMouseDown}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'inline-flex size-4 shrink-0 items-center justify-center rounded-sm',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring',
            isStalled
              ? 'text-destructive'
              : entry
                ? 'text-muted-foreground hover:text-foreground'
                : cn(
                    'text-muted-foreground/70 hover:text-foreground',
                    'can-hover:opacity-0 transition-opacity duration-150',
                    'group-hover/compact-agent-row:opacity-100 focus-visible:opacity-100'
                  )
          )}
          aria-label={label}
          title={label}
        >
          {isStalled ? (
            <TriangleAlert className="size-3.5" aria-hidden />
          ) : (
            <AlarmClock className="size-3.5" aria-hidden />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          {translate('components.agentStallTimer.title', 'Check if it is stuck')}
        </DropdownMenuLabel>
        <p className="px-2 pb-1 text-xs text-muted-foreground">
          {translate(
            'components.agentStallTimer.description',
            'Sends nothing while the worktree keeps moving. When commits and working-tree changes stop, it flags this workspace once.'
          )}
        </p>
        <DropdownMenuSeparator />
        {availability.available ? (
          <DropdownMenuRadioGroup
            value={entry ? String(entry.intervalMinutes) : OFF_VALUE}
            onValueChange={handleValueChange}
          >
            <DropdownMenuRadioItem value={OFF_VALUE}>
              {translate('components.agentStallTimer.off', 'Off')}
            </DropdownMenuRadioItem>
            {AGENT_STALL_TIMER_INTERVAL_MINUTES.map((minutes) => (
              <DropdownMenuRadioItem key={minutes} value={String(minutes)}>
                {translate('components.agentStallTimer.everyMinutes', 'Every {{minutes}} minutes', {
                  minutes
                })}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {availability.reason === 'folder-workspace'
              ? translate(
                  'components.agentStallTimer.unavailableFolderWorkspace',
                  'Not available here: this is a folder workspace, so there is no git history or working tree to measure progress from.'
                )
              : translate(
                  'components.agentStallTimer.unavailableNoWorkspace',
                  'Not available here: this pane is not attached to a workspace yet.'
                )}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function describeTriggerLabel(intervalMinutes: number | null, isStalled: boolean): string {
  if (isStalled) {
    return translate(
      'components.agentStallTimer.statusStalled',
      'No progress since the last check - open to change the stuck check'
    )
  }
  if (intervalMinutes === null) {
    return translate('components.agentStallTimer.statusOff', 'Check if it is stuck: off')
  }
  return translate(
    'components.agentStallTimer.statusArmed',
    'Checking for a stall every {{minutes}} minutes',
    { minutes: intervalMinutes }
  )
}
