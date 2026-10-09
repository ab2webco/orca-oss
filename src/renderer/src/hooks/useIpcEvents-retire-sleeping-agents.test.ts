import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useIpcEventsForCloseRouting,
  type RetireSleepingAgentSessionsListener
} from './ipc-events-close-routing-test-harness'

const WORKTREE = 'wt-1'
const TAB = '11111111-1111-4111-8111-111111111111'
const OTHER_TAB = '22222222-2222-4222-8222-222222222222'
const PANE_KEY = `${TAB}:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
const SIBLING_PANE_KEY = `${TAB}:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`
const OTHER_PANE_KEY = `${OTHER_TAB}:cccccccc-cccc-4ccc-8ccc-cccccccccccc`

let sleepingAgentSessionsByPaneKey: Record<string, { paneKey: string }> = {}

function harnessState(): Record<string, unknown> {
  return {
    tabsByWorktree: { [WORKTREE]: [] },
    unifiedTabsByWorktree: {},
    sleepingAgentSessionsByPaneKey,
    clearSleepingAgentSession: (paneKey: string) => {
      delete sleepingAgentSessionsByPaneKey[paneKey]
    },
    closeTab: vi.fn(),
    activeWorktreeId: WORKTREE,
    activeTabId: null,
    openFiles: [],
    browserTabsByWorktree: {},
    settings: { activeRuntimeEnvironmentId: null, terminalFontSize: 13 }
  }
}

// Why: the runtime forgets an explicitly closed record in main, but the renderer owns
// the records and re-persists them — without this the row came back (ORCA-560).
describe('onRetireSleepingAgentSessions', () => {
  const listenerRef: { current: RetireSleepingAgentSessionsListener | null } = { current: null }

  beforeEach(async () => {
    vi.resetModules()
    vi.unstubAllGlobals()
    listenerRef.current = null
    sleepingAgentSessionsByPaneKey = {
      [PANE_KEY]: { paneKey: PANE_KEY },
      [SIBLING_PANE_KEY]: { paneKey: SIBLING_PANE_KEY },
      [OTHER_PANE_KEY]: { paneKey: OTHER_PANE_KEY }
    }
    await useIpcEventsForCloseRouting({
      retireSleepingAgentSessionsListenerRef: listenerRef,
      getState: harnessState
    })
    expect(listenerRef.current).not.toBeNull()
  })

  it('retires only the addressed pane when a paneKey is given', () => {
    listenerRef.current?.({ tabId: TAB, paneKey: PANE_KEY })

    expect(Object.keys(sleepingAgentSessionsByPaneKey).sort()).toEqual(
      [SIBLING_PANE_KEY, OTHER_PANE_KEY].sort()
    )
  })

  it('retires every pane of the tab when no paneKey is given', () => {
    listenerRef.current?.({ tabId: TAB })

    expect(Object.keys(sleepingAgentSessionsByPaneKey)).toEqual([OTHER_PANE_KEY])
  })
})
