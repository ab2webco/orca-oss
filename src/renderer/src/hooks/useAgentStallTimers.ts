import { useEffect } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { AGENT_STALL_TIMER_POLL_MS, runDueAgentStallTicks } from '../lib/agent-stall-timer-driver'

/** One poll for every armed pane, gated on window visibility because each due tick shells out to git. */
export function useAgentStallTimers(): void {
  useEffect(
    () =>
      installWindowVisibilityInterval({
        run: () => {
          void runDueAgentStallTicks()
        },
        intervalMs: AGENT_STALL_TIMER_POLL_MS
      }),
    []
  )
}
