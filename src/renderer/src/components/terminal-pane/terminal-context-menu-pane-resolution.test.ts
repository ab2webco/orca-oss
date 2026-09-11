// @vitest-environment happy-dom
// Selecting an account in the context menu's "Switch Account & Continue"
// submenu closes the menu FIRST. `menuPaneId` is gated on `open`, so by the
// time the handler ran it was already null, the pane resolved to nothing, and
// the switch died on "No resumable Claude session was found in this terminal".
// The header button never hit this because it is handed the pane object.
import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTerminalPaneContextMenu } from './use-terminal-pane-context-menu'
import type { ManagedPane, PaneManager } from '@/lib/pane-manager/pane-manager'

const PANE = { id: 7, leafId: 'leaf-7' } as unknown as ManagedPane

function harness(): ReturnType<
  typeof renderHook<ReturnType<typeof useTerminalPaneContextMenu>, void>
> {
  const manager = {
    getPanes: () => [PANE],
    getActivePane: () => PANE
  } as unknown as PaneManager
  return renderHook(() =>
    useTerminalPaneContextMenu({
      managerRef: { current: manager },
      paneTransportsRef: { current: new Map() },
      paneCwdRef: { current: new Map() },
      containerRef: { current: null },
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      groupId: null,
      fallbackCwd: '/tmp',
      toggleExpandPane: vi.fn(),
      onRequestClosePane: vi.fn(),
      onClearPaneScrollback: vi.fn(),
      onSetTitle: vi.fn(),
      onClearPaneTitle: vi.fn(),
      onPasteError: vi.fn(),
      onAgentSessionForkReady: vi.fn(),
      onAgentSessionContinuationReady: vi.fn(),
      forceBracketedMultilineTextPaste: false,
      rightClickToPaste: false
    } as unknown as Parameters<typeof useTerminalPaneContextMenu>[0])
  )
}

describe('terminal context menu pane resolution', () => {
  it('still resolves the pane once the menu has closed, when menuPaneId is already null', () => {
    const { result } = harness()

    act(() => {
      result.current.setOpen(true)
    })
    expect(result.current.menuPaneId).toBe(PANE.id)

    // The close a menu selection performs before the action's handler runs.
    act(() => {
      result.current.setOpen(false)
    })

    // The regression, stated as the two halves that must disagree: the gated id
    // is gone, and the resolver an action must use is not.
    expect(result.current.menuPaneId).toBeNull()
    expect(result.current.resolveMenuPane()).toBe(PANE)
  })
})
