import type { OrcaEvent, OrcaTerminalPayload } from '../../../shared/orca-events'
import type { RuntimeMobileSessionClientTab } from '../../../shared/runtime-types'
import { makePaneKey } from '../../../shared/stable-pane-id'

type TerminalPane = OrcaTerminalPayload
type TrackedPane = { pane: TerminalPane; terminal: string | null }

function paneKeyOf(tabId: string, leafId: string): string | null {
  try {
    return makePaneKey(tabId, leafId)
  } catch {
    // Why: legacy/non-UUID leaf ids have no pane key; the pane still exists.
    return null
  }
}

function terminalPanes(tabs: readonly RuntimeMobileSessionClientTab[]): Map<string, TerminalPane> {
  const panes = new Map<string, TerminalPane>()
  for (const tab of tabs) {
    if (tab.type !== 'terminal') {
      continue
    }
    panes.set(tab.id, {
      tabId: tab.parentTabId,
      leafId: tab.leafId,
      paneKey: paneKeyOf(tab.parentTabId, tab.leafId),
      title: tab.title
    })
  }
  return panes
}

/** Derives terminal lifecycle events by diffing successive per-worktree session-tab snapshots. */
export class TerminalTabEventTracker {
  private readonly panesByWorktree = new Map<string, Map<string, TrackedPane>>()

  constructor(private readonly handleForPaneKey: (paneKey: string) => string | null) {}

  seed(worktreeId: string, tabs: readonly RuntimeMobileSessionClientTab[]): void {
    const tracked = new Map<string, TrackedPane>()
    for (const [id, pane] of terminalPanes(tabs)) {
      tracked.set(id, { pane, terminal: this.handleOf(pane) })
    }
    this.panesByWorktree.set(worktreeId, tracked)
  }

  update(
    worktreeId: string,
    tabs: readonly RuntimeMobileSessionClientTab[],
    at: number
  ): OrcaEvent[] {
    const previous = this.panesByWorktree.get(worktreeId) ?? new Map<string, TrackedPane>()
    const next = new Map<string, TrackedPane>()
    const events: OrcaEvent[] = []
    for (const [id, pane] of terminalPanes(tabs)) {
      const before = previous.get(id)
      // Why: keep the last known handle; the runtime stops resolving it once the pane closes.
      const terminal = this.handleOf(pane) ?? before?.terminal ?? null
      next.set(id, { pane, terminal })
      if (!before) {
        events.push({ name: 'terminal.created', at, worktreeId, terminal, payload: pane })
      } else if (before.pane.title !== pane.title) {
        events.push({
          name: 'terminal.title.changed',
          at,
          worktreeId,
          terminal,
          payload: { ...pane, previousTitle: before.pane.title }
        })
      }
    }
    for (const [id, { pane, terminal }] of previous) {
      if (!next.has(id)) {
        events.push({ name: 'terminal.closed', at, worktreeId, terminal, payload: pane })
      }
    }
    this.panesByWorktree.set(worktreeId, next)
    return events
  }

  private handleOf(pane: TerminalPane): string | null {
    return pane.paneKey ? this.handleForPaneKey(pane.paneKey) : null
  }
}
