import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import {
  findActivityTerminalPortal,
  type ActivityTerminalPortalTarget
} from '../activity/activity-terminal-portal'
import { canWatcherCoverParkedTerminalTab } from './terminal-parked-tab-watchers'
import {
  liveParkVerdictPinUntilMs,
  type ParkVerdictFlipRecord
} from './terminal-park-verdict-flip-telemetry'

/**
 * The rendered park verdict: worktree-level park (prop from Terminal.tsx) or per-tab
 * cold park, never portal-hosted tabs. Render and the watcher-sync effect must share
 * this exact set so watcher lifecycle tracks the committed unmounts.
 */
export function selectParkedTerminalTabIds(args: {
  worktreeId: string
  terminalTabs: readonly TerminalTab[]
  assignments: ReadonlyMap<string, { isActiveInGroup: boolean }>
  isWorktreeActive: boolean
  coldParkTerminalPanes: boolean
  coldParkedTerminalTabIds: ReadonlySet<string>
  sleepingRecordOwnedTabIds: ReadonlySet<string>
  evictionExemptTerminalTabIds: ReadonlySet<string>
  shouldMeasureHiddenWorktree: boolean
  activityTerminalPortals: ActivityTerminalPortalTarget[]
  activationDeferredMountTabIds?: ReadonlySet<string> | null
  parkVerdictRecords: ReadonlyMap<string, ParkVerdictFlipRecord>
  nowMs: number
}): Set<string> {
  const { worktreeId, coldParkedTerminalTabIds } = args
  const parked = new Set<string>()
  for (const terminalTab of args.terminalTabs) {
    // Why: a burst-pinned tab stays mounted under the worktree-level park too; each flip there
    // remounted the pane (new xterm, scrollback replay) for the whole pin (ORCA-1148).
    const pinnedMounted =
      liveParkVerdictPinUntilMs(args.parkVerdictRecords, terminalTab.id, args.nowMs) !== null
    const assignment = args.assignments.get(terminalTab.id)
    const isVisible = Boolean(args.isWorktreeActive && assignment && assignment.isActiveInGroup)
    const hasActivityTerminalPortal =
      findActivityTerminalPortal(args.activityTerminalPortals, {
        worktreeId,
        tabId: terminalTab.id
      }) !== null
    if (
      ((args.coldParkTerminalPanes && !pinnedMounted) ||
        (!isVisible &&
          coldParkedTerminalTabIds.has(terminalTab.id) &&
          // Why: a pane owning a sleeping-session record must stay mountable
          // on an active worktree — parked it can never cold-restore, so the
          // agent's resume strands until the user reveals the tab. Scoped to
          // per-tab parks: the worktree-level park clears on activation.
          !args.sleepingRecordOwnedTabIds.has(terminalTab.id))) &&
      !hasActivityTerminalPortal &&
      // Why: a force-parked worktree's eviction-exempt tabs keep their
      // mounted panes — a remount would orphan their live pty. Scoped to
      // force-parks: ordinary parks never contain exempt tabs (eligibility
      // requires every tab restorable, so the memo is empty for them).
      !args.evictionExemptTerminalTabIds.has(terminalTab.id) &&
      // Why: the hidden-measuring startup probe needs mounted panes; gate
      // here too so the reveal lands in the same render that starts it.
      !args.shouldMeasureHiddenWorktree
    ) {
      parked.add(terminalTab.id)
    }
    // Why: activation-deferred tabs render no pane regardless of the park
    // policy, so watchers must own their side effects immediately. Targeted
    // restrictions do not enter this set or add a new eager watcher burst.
    if (
      args.activationDeferredMountTabIds?.has(terminalTab.id) &&
      !hasActivityTerminalPortal &&
      canWatcherCoverParkedTerminalTab(worktreeId, terminalTab)
    ) {
      parked.add(terminalTab.id)
    }
  }
  return parked
}
