import { useEffect, type RefObject } from 'react'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import {
  liveParkVerdictPinUntilMs,
  type ParkVerdictFlipRecord
} from './terminal-park-verdict-flip-telemetry'

/**
 * Wakes the park verdict when the earliest live pin lapses under a steady worktree-level
 * park. Why: no other input changes then, so a pinned pane would stay mounted
 * indefinitely (ORCA-1148).
 */
export function useParkVerdictPinExpiryWake(args: {
  coldParkTerminalPanes: boolean
  records: RefObject<Map<string, ParkVerdictFlipRecord>>
  terminalTabs: readonly TerminalTab[]
  parkedTerminalTabIds: ReadonlySet<string>
  onPinExpired: () => void
}): void {
  const { coldParkTerminalPanes, records, terminalTabs, parkedTerminalTabIds, onPinExpired } = args
  useEffect(() => {
    if (!coldParkTerminalPanes) {
      return
    }
    const nowMs = Date.now()
    let earliestUntilMs: number | null = null
    for (const terminalTab of terminalTabs) {
      const untilMs = liveParkVerdictPinUntilMs(records.current, terminalTab.id, nowMs)
      if (untilMs !== null && (earliestUntilMs === null || untilMs < earliestUntilMs)) {
        earliestUntilMs = untilMs
      }
    }
    if (earliestUntilMs === null) {
      return
    }
    const timer = window.setTimeout(onPinExpired, earliestUntilMs - nowMs + 1)
    return () => window.clearTimeout(timer)
  }, [coldParkTerminalPanes, records, parkedTerminalTabIds, terminalTabs, onPinExpired])
}
