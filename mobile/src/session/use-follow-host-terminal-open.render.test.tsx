import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { MobileSessionTab } from './mobile-session-route-types'

const router = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('expo-router', async () => {
  const { useEffect } = await import('react')
  return {
    useRouter: () => router,
    // Why: the screen under test is always the focused one here.
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect])
  }
})

import { useFollowHostTerminalOpen } from './use-follow-host-terminal-open'

const memberTab = {
  type: 'terminal',
  id: 'tab-member-mobile',
  title: 'member',
  parentTabId: 'tab-member',
  terminal: 'term_member',
  isActive: false
} as MobileSessionTab

function Harness(props: {
  client: RpcClient
  worktreeId: string
  routeTerminal?: string
  routeTab?: string
  sessionTabs: MobileSessionTab[]
  selectTab: (tab: MobileSessionTab) => void
}): null {
  useFollowHostTerminalOpen({
    hostId: 'host-1',
    ...props,
    routeTerminal: props.routeTerminal,
    routeTab: props.routeTab
  })
  return null
}

describe('useFollowHostTerminalOpen', () => {
  let container: HTMLDivElement
  let root: Root
  let eventListener: ((payload: unknown) => void) | null
  let client: RpcClient
  let selectTab: ReturnType<typeof vi.fn>

  beforeEach(() => {
    router.push.mockReset()
    eventListener = null
    selectTab = vi.fn()
    client = {
      subscribe: vi.fn(
        (_method: string, _params: unknown, listener: (payload: unknown) => void) => {
          eventListener = listener
          return () => {}
        }
      )
    } as unknown as RpcClient
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(props: Partial<Parameters<typeof Harness>[0]> & { worktreeId: string }): void {
    act(() => {
      root.render(createElement(Harness, { client, sessionTabs: [], selectTab, ...props }))
    })
  }

  it('pushes the member session over the lead so back returns to it', () => {
    render({ worktreeId: 'wt-lead' })
    act(() => {
      eventListener?.({
        type: 'openTerminal',
        worktreeId: 'wt-member',
        terminal: 'term_member',
        tabId: 'tab-member',
        sourceWorktreeId: 'wt-lead'
      })
    })
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/h/[hostId]/session/[worktreeId]',
      params: {
        hostId: 'host-1',
        worktreeId: 'wt-member',
        terminal: 'term_member',
        tab: 'tab-member'
      }
    })
    expect(selectTab).not.toHaveBeenCalled()
  })

  it('switches tab in place when the terminal is in the same workspace', () => {
    render({ worktreeId: 'wt-lead', sessionTabs: [memberTab] })
    act(() => {
      eventListener?.({
        type: 'openTerminal',
        worktreeId: 'wt-lead',
        terminal: 'term_member',
        tabId: 'tab-member',
        sourceWorktreeId: 'wt-lead'
      })
    })
    expect(router.push).not.toHaveBeenCalled()
    expect(selectTab).toHaveBeenCalledWith(memberTab)
  })

  it('selects the pushed terminal once its tab arrives, and only once', () => {
    render({ worktreeId: 'wt-member', routeTerminal: 'term_member', routeTab: 'tab-member' })
    expect(selectTab).not.toHaveBeenCalled()
    render({
      worktreeId: 'wt-member',
      routeTerminal: 'term_member',
      routeTab: 'tab-member',
      sessionTabs: [memberTab]
    })
    render({
      worktreeId: 'wt-member',
      routeTerminal: 'term_member',
      routeTab: 'tab-member',
      sessionTabs: [{ ...memberTab }]
    })
    expect(selectTab).toHaveBeenCalledTimes(1)
    expect(selectTab).toHaveBeenCalledWith(memberTab)
  })
})
