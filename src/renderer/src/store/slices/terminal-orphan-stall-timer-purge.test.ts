import { describe, expect, it } from 'vitest'
import { buildOrphanTerminalCleanupPatch } from './terminal-orphan-helpers'

type PatchState = Parameters<typeof buildOrphanTerminalCleanupPatch>[0]

const WORKTREE_ID = 'wt-1'
const ORPHAN_TAB_ID = 'T-orphan'
const LIVE_TAB_ID = 'T-live'
const ORPHAN_PANE_KEY = `${ORPHAN_TAB_ID}:11111111-1111-4111-8111-111111111111`
const LIVE_PANE_KEY = `${LIVE_TAB_ID}:22222222-2222-4222-8222-222222222222`

function makeState(): PatchState {
  return {
    tabsByWorktree: {
      [WORKTREE_ID]: [{ id: ORPHAN_TAB_ID }, { id: LIVE_TAB_ID }]
    },
    ptyIdsByTabId: {},
    runtimePaneTitlesByTabId: {},
    expandedPaneByTabId: {},
    canExpandPaneByTabId: {},
    terminalLayoutsByTabId: {},
    pendingStartupByTabId: {},
    pendingInitialCwdByTabId: {},
    pendingSetupSplitByTabId: {},
    pendingIssueCommandSplitByTabId: {},
    automaticAgentResumeClaimsByTabId: {},
    nativeChatLaunchPromptByTabId: {},
    nativeChatLaunchDraftByTabId: {},
    tabBarOrderByWorktree: { [WORKTREE_ID]: [ORPHAN_TAB_ID, LIVE_TAB_ID] },
    cacheTimerByKey: { [ORPHAN_PANE_KEY]: 1, [LIVE_PANE_KEY]: 1 },
    agentStallTimerByPaneKey: {
      [ORPHAN_PANE_KEY]: {
        intervalMinutes: 15,
        nextTickAt: 0,
        detector: { lastFingerprint: 'a', escalated: true },
        status: 'stalled'
      },
      [LIVE_PANE_KEY]: {
        intervalMinutes: 15,
        nextTickAt: 0,
        detector: { lastFingerprint: 'a', escalated: false },
        status: 'watching'
      }
    },
    activeTabIdByWorktree: {},
    activeTabId: null
  } as unknown as PatchState
}

describe('orphan terminal sweep and stall timers', () => {
  it('drops the swept tab’s stall timer, which otherwise polls for the renderer’s lifetime', () => {
    // A stalled entry left behind is worse than a leak: its tab is gone from tabsByWorktree,
    // so the card banner can no longer report it and nothing can disarm it.
    const patch = buildOrphanTerminalCleanupPatch(
      makeState(),
      WORKTREE_ID,
      new Set([ORPHAN_TAB_ID])
    )

    expect(patch.agentStallTimerByPaneKey[ORPHAN_PANE_KEY]).toBeUndefined()
    expect(patch.agentStallTimerByPaneKey[LIVE_PANE_KEY]).toBeDefined()
  })

  it('leaves every timer alone when nothing was orphaned', () => {
    const patch = buildOrphanTerminalCleanupPatch(makeState(), WORKTREE_ID, new Set())

    expect(Object.keys(patch.agentStallTimerByPaneKey)).toEqual([ORPHAN_PANE_KEY, LIVE_PANE_KEY])
  })
})
