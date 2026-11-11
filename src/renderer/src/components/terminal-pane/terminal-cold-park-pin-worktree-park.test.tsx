/** @vitest-environment happy-dom */
/**
 * ORCA-1148: a renderer grew 946 -> 2310 MB of Blink memory in 11 min while one tab's
 * park-verdict pin re-armed every minute. The pin only damped the per-tab cold set, so
 * churn driven by the worktree-level park kept remounting the pane (a new xterm and a
 * scrollback replay per flip) through the whole pin, with its breadcrumbs suppressed.
 */
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WORKTREE_ID = 'repo::/wt-pin-worktree-park'
const TAB_ID = 'tab-a'

vi.mock('../../store', async () => {
  const { create } = await import('zustand')
  const useAppStore = create(() => ({
    pendingStartupByTabId: {} as Record<string, unknown>,
    ptyIdsByTabId: {} as Record<string, string[]>,
    runtimeStatusByEnvironmentId: new Map<string, unknown>(),
    settings: {} as Record<string, unknown>,
    terminalLayoutsByTabId: {} as Record<string, unknown>,
    runtimePaneTitlesByTabId: {} as Record<string, unknown>,
    tabsByWorktree: {} as Record<string, TerminalTab[]>
  }))
  return { useAppStore }
})

vi.mock('./terminal-parked-tab-watchers', () => ({
  canWatcherCoverParkedTerminalTab: () => true,
  disposeParkedTerminalWatchersForWorktree: () => {},
  resolveParkedTerminalPaneCandidates: () => [],
  syncParkedTerminalTabWatchers: () => {}
}))

vi.mock('./terminal-parking-e2e-overrides', () => ({
  getTerminalParkingPolicyOverrides: () => ({ coldParkDelayMs: 0, hotRetainMs: 0 })
}))

import {
  TERMINAL_TAB_PARK_FLIP_BURST_LIMIT,
  TERMINAL_TAB_PARK_FLIP_WINDOW_MS
} from './terminal-park-verdict-flip-telemetry'
import { useTerminalTabColdParking } from './use-terminal-tab-cold-parking'

const TERMINAL_TABS = [
  { id: TAB_ID, ptyId: `${WORKTREE_ID}@@session-a`, title: 'a' } as TerminalTab
]
const EMPTY_ASSIGNMENTS = new Map<string, { groupId: string; isActiveInGroup: boolean }>()
const EMPTY_PORTALS: never[] = []

let paneMounts = 0

function PaneStandIn(): React.JSX.Element {
  useEffect(() => {
    paneMounts += 1
  }, [])
  return <i data-pane="" />
}

function Host({ coldParkTerminalPanes }: { coldParkTerminalPanes: boolean }): React.JSX.Element {
  const parked = useTerminalTabColdParking({
    worktreeId: WORKTREE_ID,
    terminalTabs: TERMINAL_TABS,
    assignments: EMPTY_ASSIGNMENTS,
    isWorktreeActive: false,
    activeTerminalTabId: null,
    coldParkTerminalPanes,
    shouldMeasureHiddenWorktree: false,
    activityTerminalPortals: EMPTY_PORTALS,
    activationDeferredMountTabIds: null
  })
  return <>{parked.has(TAB_ID) ? null : <PaneStandIn />}</>
}

describe('park-verdict pin against worktree-level park churn', () => {
  let container: HTMLDivElement
  let root: Root | undefined
  let nowMs = 1_000_000

  beforeEach(() => {
    paneMounts = 0
    nowMs = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    container.remove()
    vi.restoreAllMocks()
  })

  const render = (coldParkTerminalPanes: boolean): void => {
    act(() => root!.render(<Host coldParkTerminalPanes={coldParkTerminalPanes} />))
  }

  it('stops remounting the pane once a flip burst pins the tab, whatever drives the park', () => {
    render(false)
    const mountsBeforeChurn = paneMounts
    for (let flip = 0; flip < 10; flip += 1) {
      nowMs += 50
      render(flip % 2 === 0)
    }

    // Why the bound: the burst that engages the pin may remount up to that many times; after it, none.
    expect(paneMounts - mountsBeforeChurn).toBeLessThanOrEqual(
      Math.ceil(TERMINAL_TAB_PARK_FLIP_BURST_LIMIT / 2) + 1
    )
  })

  it('parks the tab on its own when the pin expires under a steady worktree-level park', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      render(false)
      for (let flip = 0; flip < 10; flip += 1) {
        nowMs += 50
        render(flip % 2 === 0)
      }
      render(true)
      expect(container.querySelector('[data-pane]')).not.toBeNull()

      nowMs += TERMINAL_TAB_PARK_FLIP_WINDOW_MS + 1
      act(() => vi.advanceTimersByTime(TERMINAL_TAB_PARK_FLIP_WINDOW_MS + 1))

      expect(container.querySelector('[data-pane]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets the worktree-level park through again once the pin expires', () => {
    render(false)
    for (let flip = 0; flip < 10; flip += 1) {
      nowMs += 50
      render(flip % 2 === 0)
    }
    nowMs += TERMINAL_TAB_PARK_FLIP_WINDOW_MS + 1
    render(false)
    nowMs += 1
    render(true)

    expect(container.querySelector('[data-pane]')).toBeNull()
  })
})
