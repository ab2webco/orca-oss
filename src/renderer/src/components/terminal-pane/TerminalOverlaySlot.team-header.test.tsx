/** @vitest-environment happy-dom */
import { act, useEffect, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let terminalMounts = 0
vi.mock('./TerminalPane', () => ({
  default: function TerminalPaneProbe() {
    useEffect(() => {
      terminalMounts += 1
    }, [])
    return <div data-terminal-pane="" />
  }
}))
vi.mock('../../store', () => ({
  useAppStore: Object.assign(() => undefined, {
    getState: () => ({ pendingStartupByTabId: {} })
  })
}))

let headerShown = false
const listeners = new Set<() => void>()
const showHeader = (shown: boolean): void => {
  headerShown = shown
  listeners.forEach((listener) => listener())
}
vi.mock('../team-panel/TeamMemberPaneHeader', () => ({
  TeamMemberPaneHeader: function TeamMemberPaneHeaderProbe({ tabId }: { tabId: string }) {
    const shown = useSyncExternalStore(
      (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      () => headerShown
    )
    return shown ? <div data-team-member-header={tabId} /> : null
  }
}))

const { TerminalOverlaySlot } = await import('./TerminalOverlaySlot')

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
})

it("heads a member's terminal tab without remounting its terminal", () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <TerminalOverlaySlot
        terminalTabId="tab-7"
        terminalGeneration={0}
        worktreeId="wt-7"
        worktreePath="/wt-7"
        startupCwd={undefined}
        groupId={undefined}
        isWorktreeActive
        isVisible
        isActive
        activityTerminalPortal={null}
        onFocusOwningGroup={undefined}
        consumeSuppressedPtyExit={() => false}
        leaveWorktreeIfEmpty={vi.fn()}
      />
    )
  })
  expect(terminalMounts).toBe(1)

  act(() => showHeader(true))
  const header = container.querySelector('[data-team-member-header="tab-7"]')
  expect(header?.nextElementSibling?.querySelector('[data-terminal-pane]')).not.toBeNull()

  act(() => showHeader(false))
  expect(container.querySelector('[data-team-member-header]')).toBeNull()
  expect(terminalMounts).toBe(1)
})
