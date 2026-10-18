import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  hostTerminalOpenRequestFor,
  hostTerminalOpenRoute,
  sessionTabForHostOpen,
  startHostTerminalOpenFollow
} from './host-terminal-open'
import type { MobileSessionTab } from './mobile-session-route-types'

const appState = vi.hoisted(() => ({ currentState: 'active' }))

vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return appState.currentState
    }
  }
}))

const OPEN_MEMBER = {
  type: 'openTerminal',
  worktreeId: 'wt-member',
  terminal: 'term_member',
  tabId: 'tab-member',
  sourceWorktreeId: 'wt-lead'
}

describe('hostTerminalOpenRequestFor', () => {
  it('follows a request sent from the workspace this screen shows', () => {
    expect(hostTerminalOpenRequestFor(OPEN_MEMBER, 'wt-lead')).toEqual({
      worktreeId: 'wt-member',
      terminal: 'term_member',
      tabId: 'tab-member'
    })
  })

  it('ignores a request from another workspace, another event, or a malformed frame', () => {
    expect(hostTerminalOpenRequestFor(OPEN_MEMBER, 'wt-other')).toBeNull()
    expect(hostTerminalOpenRequestFor({ type: 'worktreesChanged', repoId: 'r' }, 'wt-lead')).toBe(
      null
    )
    expect(hostTerminalOpenRequestFor({ ...OPEN_MEMBER, terminal: 42 }, 'wt-lead')).toBeNull()
    expect(hostTerminalOpenRequestFor({ ...OPEN_MEMBER, worktreeId: '' }, 'wt-lead')).toBeNull()
    expect(hostTerminalOpenRequestFor(null, 'wt-lead')).toBeNull()
  })
})

describe('hostTerminalOpenRoute', () => {
  it('pushes the member session with the terminal and tab to select', () => {
    expect(
      hostTerminalOpenRoute('host-1', {
        worktreeId: 'wt-member',
        terminal: 'term_member',
        tabId: 'tab-member'
      })
    ).toEqual({
      pathname: '/h/[hostId]/session/[worktreeId]',
      params: {
        hostId: 'host-1',
        worktreeId: 'wt-member',
        terminal: 'term_member',
        tab: 'tab-member'
      }
    })
  })
})

describe('sessionTabForHostOpen', () => {
  const terminalTab = (id: string, terminal: string | null, parentTabId?: string) =>
    ({
      type: 'terminal',
      id,
      title: id,
      terminal,
      isActive: false,
      ...(parentTabId ? { parentTabId } : {})
    }) as MobileSessionTab

  it('picks the tab by handle first, then by the host tab id', () => {
    const byHandle = terminalTab('t1', 'term_member')
    const byParent = terminalTab('t2', 'term_reminted', 'tab-member')
    expect(
      sessionTabForHostOpen([byParent, byHandle], { terminal: 'term_member', tabId: 'tab-member' })
    ).toBe(byHandle)
    expect(
      sessionTabForHostOpen([byParent], { terminal: 'term_member', tabId: 'tab-member' })
    ).toBe(byParent)
    expect(
      sessionTabForHostOpen([terminalTab('t3', 'term_x')], {
        terminal: 'term_member',
        tabId: 'tab-member'
      })
    ).toBeNull()
  })
})

describe('startHostTerminalOpenFollow', () => {
  let eventListener: ((payload: unknown) => void) | null
  let unsubscribe: ReturnType<typeof vi.fn>
  let onOpen: ReturnType<typeof vi.fn>
  let following: boolean

  beforeEach(() => {
    appState.currentState = 'active'
    eventListener = null
    unsubscribe = vi.fn()
    onOpen = vi.fn()
    following = true
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function start(): () => void {
    const client = {
      subscribe: vi.fn(
        (_method: string, _params: unknown, listener: (payload: unknown) => void) => {
          eventListener = listener
          return unsubscribe
        }
      )
    } as unknown as RpcClient
    return startHostTerminalOpenFollow({
      client,
      worktreeId: 'wt-lead',
      isFollowing: () => following,
      onOpen
    })
  }

  it('opens the requested terminal while this screen is in front', () => {
    start()
    eventListener?.(OPEN_MEMBER)
    expect(onOpen).toHaveBeenCalledWith({
      worktreeId: 'wt-member',
      terminal: 'term_member',
      tabId: 'tab-member'
    })
  })

  it('stays put when the screen is covered or the app is in the background', () => {
    start()
    following = false
    eventListener?.(OPEN_MEMBER)
    following = true
    appState.currentState = 'background'
    eventListener?.(OPEN_MEMBER)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('stops listening when stopped', () => {
    const stop = start()
    stop()
    eventListener?.(OPEN_MEMBER)
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })
})
