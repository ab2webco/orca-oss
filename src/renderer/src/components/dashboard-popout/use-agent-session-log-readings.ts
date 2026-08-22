import { useEffect, useState } from 'react'
import type { AgentSessionLogPaneReading } from '../../../../shared/agent-session-log-state'

/** Measured over 7 and 12 live transcripts: a batch costs ~1.5-1.7 ms median,
 *  so the interval is chosen for staleness, not for cost (ORCA-234). */
export const AGENT_SESSION_LOG_POLL_MS = 3_000

export type AgentSessionLogReadPanes = (paneKeys: string[]) => Promise<AgentSessionLogPaneReading[]>

/**
 * Polls the batch session-log reader for the panes on screen.
 *
 * The pane set travels as a sorted primitive so the effect owns it outright:
 * holding it in a ref would mean writing that ref during render, which React
 * may replay or discard.
 *
 * Deliberately not gated on document visibility or a paint callback: the E2E
 * window is never shown, and such a gate would make the grid look permanently
 * empty there while looking fine by hand.
 */
export function useAgentSessionLogReadings(
  paneKeys: readonly string[],
  options: { readPanes?: AgentSessionLogReadPanes; intervalMs?: number } = {}
): ReadonlyMap<string, AgentSessionLogPaneReading> {
  const [readings, setReadings] = useState<ReadonlyMap<string, AgentSessionLogPaneReading>>(
    () => new Map()
  )
  const signature = paneKeys.toSorted().join(' ')
  const readPanes = options.readPanes
  const intervalMs = options.intervalMs ?? AGENT_SESSION_LOG_POLL_MS

  useEffect(() => {
    const panes = signature === '' ? [] : signature.split(' ')
    // ?. shields the pop-out from dev-HMR preload skew: the renderer reloads hot,
    // the preload only on app restart, so the channel can be missing.
    const read = readPanes ?? window.api.agentSessionLog?.readPanes
    if (!read || panes.length === 0) {
      setReadings(new Map())
      return undefined
    }
    let cancelled = false
    const tick = async (): Promise<void> => {
      let next: AgentSessionLogPaneReading[]
      try {
        next = await read([...panes])
      } catch {
        return
      }
      if (!cancelled) {
        setReadings(new Map(next.map((reading) => [reading.paneKey, reading])))
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [signature, readPanes, intervalMs])

  return readings
}
