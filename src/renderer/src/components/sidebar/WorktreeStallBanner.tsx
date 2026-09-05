import React, { useCallback } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { armAgentStallTimer } from '@/lib/agent-stall-timer-driver'
import { selectStalledPanesForWorktree } from '@/lib/agent-stall-timer-target'

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
    useShallow((s) => selectStalledPanesForWorktree(s, worktreeId).map((pane) => pane.paneKey))
  )

  const handleStopWatching = useCallback(() => {
    for (const paneKey of stalledPaneKeys) {
      armAgentStallTimer(paneKey, null)
    }
  }, [stalledPaneKeys])

  if (stalledPaneKeys.length === 0) {
    return null
  }

  return (
    <div
      className="mt-0.5 flex items-start gap-1.5 rounded border px-1.5 py-1 text-[10.5px] leading-snug"
      style={{
        borderColor: 'color-mix(in srgb, var(--destructive) 25%, transparent)',
        background: 'color-mix(in srgb, var(--destructive) 6%, transparent)',
        color: 'var(--destructive)'
      }}
      role="status"
    >
      <TriangleAlert className="mt-[1px] size-3 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        {stalledPaneKeys.length === 1
          ? translate(
              'components.agentStallTimer.bannerSingle',
              'No progress here since the last check.'
            )
          : translate(
              'components.agentStallTimer.bannerMultiple',
              'No progress from {{count}} agents here since the last check.',
              { count: stalledPaneKeys.length }
            )}
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
