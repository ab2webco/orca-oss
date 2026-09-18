import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentBrowserBridge } from '../browser/agent-browser-bridge'
import type { BrowserBackend } from '../browser/browser-backend'
import type { RuntimeBrowserCommandHost } from './orca-runtime-browser'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/floating-workspace-selector'

const {
  ipcMainOnMock,
  ipcMainRemoveListenerMock,
  webContentsFromIdMock,
  waitForTabRegistrationMock,
  waitForWorktreeTabRegistrationMock,
  getWorktreeIdForTabMock
} = vi.hoisted(() => ({
  ipcMainOnMock: vi.fn(),
  ipcMainRemoveListenerMock: vi.fn(),
  webContentsFromIdMock: vi.fn(),
  waitForTabRegistrationMock: vi.fn(),
  waitForWorktreeTabRegistrationMock: vi.fn(),
  getWorktreeIdForTabMock: vi.fn((): string | undefined => undefined)
}))

vi.mock('electron', () => ({
  ipcMain: { on: ipcMainOnMock, removeListener: ipcMainRemoveListenerMock },
  webContents: { fromId: webContentsFromIdMock }
}))

vi.mock('../browser/browser-screencast-stream', () => ({
  startBrowserScreencast: vi.fn()
}))

vi.mock('../ipc/browser-tab-registration-wait', () => ({
  waitForTabRegistration: waitForTabRegistrationMock,
  waitForWorktreeTabRegistration: waitForWorktreeTabRegistrationMock
}))

vi.mock('../browser/browser-manager', () => ({
  browserManager: {
    getWorktreeIdForTab: getWorktreeIdForTabMock,
    getSessionProfileIdForTab: vi.fn(() => null)
  },
  browserCertificateTrustController: { proceed: vi.fn() }
}))

const DEFAULT_PROFILE = {
  id: 'default',
  scope: 'default',
  partition: 'persist:orca-browser',
  label: 'Default',
  source: null
}

vi.mock('../browser/browser-session-registry', () => ({
  browserSessionRegistry: {
    getDefaultProfile: vi.fn(() => DEFAULT_PROFILE),
    getProfile: vi.fn(() => DEFAULT_PROFILE),
    resolveKnownPartition: vi.fn(() => 'persist:orca-browser'),
    createProfile: vi.fn()
  }
}))

import { RuntimeBrowserCommands } from './orca-runtime-browser'

// Why: the host resolver only knows Git worktrees, so it rejects here exactly as the live runtime
// does — any test that passes is proving the floating scope never reached it.
function createFixture() {
  const resolveWorktreeSelector = vi.fn(async (): Promise<{ id: string }> => {
    throw new Error('selector_not_found')
  })
  const createTab = vi.fn(async () => ({ browserPageId: 'page-floating' }))
  const tabList = vi.fn(() => ({
    tabs: [
      {
        browserPageId: 'page-floating',
        index: 0,
        url: 'https://example.com/',
        title: 'Example',
        active: true
      }
    ]
  }))
  const bridge = {
    getRegisteredTabs: vi.fn(() => new Map([['page-floating', 100]])),
    getActivePageId: vi.fn(() => 'page-floating'),
    getActiveWebContentsId: vi.fn(() => 100),
    setActiveTab: vi.fn(),
    tabList
  } as unknown as AgentBrowserBridge
  const host = {
    resolveWorktreeSelector,
    getAgentBrowserBridge: () => bridge,
    getAuthoritativeWindow: vi.fn(),
    getAvailableAuthoritativeWindow: vi.fn(() => null),
    getOffscreenBrowserBackend: vi.fn(() => ({ createTab }) as unknown as BrowserBackend)
  } as unknown as RuntimeBrowserCommandHost
  return { commands: new RuntimeBrowserCommands(host), resolveWorktreeSelector, createTab, tabList }
}

describe('RuntimeBrowserCommands floating workspace selector', () => {
  beforeEach(() => {
    webContentsFromIdMock.mockReset()
    webContentsFromIdMock.mockReturnValue({ isDestroyed: () => false })
    waitForTabRegistrationMock.mockReset()
    waitForTabRegistrationMock.mockResolvedValue(undefined)
    waitForWorktreeTabRegistrationMock.mockReset()
    waitForWorktreeTabRegistrationMock.mockResolvedValue(undefined)
    getWorktreeIdForTabMock.mockReset()
    getWorktreeIdForTabMock.mockReturnValue(FLOATING_TERMINAL_WORKTREE_ID)
  })

  it.each(['floating', 'id:global-floating-terminal', 'global-floating-terminal'])(
    'creates a tab in the floating workspace for selector %s',
    async (selector) => {
      const fixture = createFixture()

      await expect(
        fixture.commands.browserTabCreate({ url: 'https://example.com', worktree: selector })
      ).resolves.toEqual({ browserPageId: 'page-floating' })

      expect(fixture.resolveWorktreeSelector).not.toHaveBeenCalled()
      expect(fixture.createTab).toHaveBeenCalledWith(
        expect.objectContaining({ worktreeId: FLOATING_TERMINAL_WORKTREE_ID })
      )
    }
  )

  it('lists only the floating workspace tabs', async () => {
    const fixture = createFixture()

    const result = await fixture.commands.browserTabList({ worktree: 'floating' })

    expect(fixture.resolveWorktreeSelector).not.toHaveBeenCalled()
    expect(fixture.tabList).toHaveBeenCalledWith(FLOATING_TERMINAL_WORKTREE_ID)
    expect(result.tabs[0].worktreeId).toBe(FLOATING_TERMINAL_WORKTREE_ID)
  })

  it('evaluates against a page scoped to the floating workspace', async () => {
    const fixture = createFixture()

    await fixture.commands
      .browserExec({ command: 'noop', worktree: 'floating', page: 'page-floating' })
      .catch(() => undefined)

    expect(fixture.resolveWorktreeSelector).not.toHaveBeenCalled()
  })

  it('still delegates every other selector to the host resolver', async () => {
    const fixture = createFixture()

    await expect(
      fixture.commands.browserTabList({ worktree: 'id:repo::/tmp/repo' })
    ).rejects.toThrow('selector_not_found')
    expect(fixture.resolveWorktreeSelector).toHaveBeenCalledWith('id:repo::/tmp/repo')
  })
})
