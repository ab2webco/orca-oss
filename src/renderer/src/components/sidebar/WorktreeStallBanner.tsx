import React, { useCallback } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { armAgentStallTimer } from '@/lib/agent-stall-timer-driver'
import {
  selectStalledPaneKeysForWorktree,
  selectUnmeasurablePaneKeysForWorktree
} from '@/lib/agent-stall-timer-target'

type WorktreeStallBannerProps = {
  worktreeId: string
}

/**
 * Card-level alert for panes whose progress stopped. It reads the timer map, not the agent
 * rows, so it outlives a pane whose process died - the case the row would stop rendering.
 */
export function WorktreeStallBanner({
  worktreeId
}: WorktreeStallBannerProps): React.JSX.Element | null {
  const stalledPaneKeys = useAppStore(
    useShallow((s) => selectStalledPaneKeysForWorktree(s, worktreeId))
  )
  // An armed pane whose workspace can no longer be measured has no other disarm surface:
  // the row's interval picker hides itself once availability turns false.
  const unmeasurablePaneKeys = useAppStore(
    useShallow((s) => selectUnmeasurablePaneKeysForWorktree(s, worktreeId))
  )
  const reportedPaneKeys = stalledPaneKeys.length > 0 ? stalledPaneKeys : unmeasurablePaneKeys

  const handleStopWatching = useCallback(() => {
    for (const paneKey of reportedPaneKeys) {
      armAgentStallTimer(paneKey, null)
    }
  }, [reportedPaneKeys])

  if (reportedPaneKeys.length === 0) {
    return null
  }
  const isStalled = stalledPaneKeys.length > 0

  return (
    <div
      className={cn(
        'mt-0.5 flex items-start gap-1.5 rounded border px-1.5 py-1 text-[10.5px] leading-snug',
        isStalled
          ? 'border-destructive/25 bg-destructive/5 text-destructive'
          : 'border-border bg-muted/40 text-muted-foreground'
      )}
      role="status"
    >
      <TriangleAlert className="mt-[1px] size-3 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        {!isStalled
          ? translate(
              'components.agentStallTimer.bannerUnmeasurable',
              'The stuck check is armed here but can no longer read this workspace, so it will never fire.'
            )
          : translate(
              'components.agentStallTimer.bannerSingle',
              'No progress in this workspace since the last check.'
            )}
        {isStalled ? (
          <>
            {' '}
            <span className="opacity-80">
              {translate(
                'components.agentStallTimer.bannerScope',
                'Measured across the whole workspace. Another agent working here keeps it quiet, and the contents of an unadded file, or of a submodule, are not counted yet.'
              )}
            </span>
          </>
        ) : null}
      </span>
      <button
        type="button"
        onClick={handleStopWatching}
        className="shrink-0 underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {translate('components.agentStallTimer.bannerStopWatching', 'Stop watching')}
      </button>
    </div>
  )
}
