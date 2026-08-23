import { useEffect, useState } from 'react'
import type {
  AgentTerminalTailPtyReading,
  AgentTerminalTailReading
} from '../../../../shared/agent-terminal-tail'

/** Fast enough that a cell reads as live, slow enough that main's per-pty read
 *  floor (AGENT_TERMINAL_TAIL_MIN_READ_INTERVAL_MS) never becomes the limit. */
export const AGENT_TERMINAL_TAIL_POLL_MS = 1_500

export type AgentTerminalTailReadPtys = (
  ptyIds: string[],
  lines: number
) => Promise<AgentTerminalTailPtyReading[]>

/**
 * Polls the batch terminal-tail reader for the panes on screen.
 *
 * The pty set travels as a sorted primitive for the same reason its
 * session-log twin does: holding it in a ref would mean writing that ref
 * during render, which React may replay or discard.
 */
export function useAgentTerminalTails(
  ptyIds: readonly string[],
  options: { readPtys?: AgentTerminalTailReadPtys; intervalMs?: number; lines: number }
): ReadonlyMap<string, AgentTerminalTailReading> {
  const [tails, setTails] = useState<ReadonlyMap<string, AgentTerminalTailReading>>(
    () => new Map()
  )
  const signature = ptyIds.toSorted().join(' ')
  const readPtys = options.readPtys
  const intervalMs = options.intervalMs ?? AGENT_TERMINAL_TAIL_POLL_MS
  const lines = options.lines

  useEffect(() => {
    const ptys = signature === '' ? [] : signature.split(' ')
    // ?. shields the pop-out from dev-HMR preload skew: the renderer reloads
    // hot, the preload only on app restart, so the channel can be missing.
    const read = readPtys ?? window.api.agentTerminalTail?.readPtys
    if (!read || ptys.length === 0) {
      setTails(new Map())
      return undefined
    }
    let cancelled = false
    const tick = async (): Promise<void> => {
      let next: AgentTerminalTailPtyReading[]
      try {
        next = await read([...ptys], lines)
      } catch {
        return
      }
      if (!cancelled) {
        setTails(new Map(next.map((reading) => [reading.ptyId, reading.tail])))
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [signature, readPtys, intervalMs, lines])

  return tails
}
