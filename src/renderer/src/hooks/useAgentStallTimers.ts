import { useEffect } from 'react'
import { AGENT_STALL_TIMER_POLL_MS, runDueAgentStallTicks } from '../lib/agent-stall-timer-driver'

/** One poll for every armed pane, mirroring the shared prompt-cache clock rather than an interval per pane. */
export function useAgentStallTimers(): void {
  useEffect(() => {
    const interval = setInterval(() => {
      void runDueAgentStallTicks()
    }, AGENT_STALL_TIMER_POLL_MS)
    return () => clearInterval(interval)
  }, [])
}
