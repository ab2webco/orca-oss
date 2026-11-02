import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  appSetBadgeCountMock,
  getDispatchHandler,
  getNotificationEventHandler,
  getSetBadgeCountHandler,
  getTrustedUIRendererWindowMock,
  notificationCtorMock,
  resetNotificationDispatchMocks
} from './notifications-test-harness'

vi.mock('electron', async () =>
  (await import('./notifications-test-harness')).createElectronModuleMock()
)

vi.mock('./notification-authorization-status', async () =>
  (await import('./notifications-test-harness')).createNotificationAuthorizationModuleMock()
)

vi.mock('./ui', async () =>
  (await import('./notifications-test-harness')).createTrustedUIRendererModuleMock()
)

vi.mock('../tray/system-tray', async () =>
  (await import('./notifications-test-harness')).createSystemTrayModuleMock()
)

import { registerNotificationHandlers } from './notifications'

const settings = (overrides: Record<string, unknown> = {}) =>
  ({
    getSettings: () => ({
      notifications: {
        enabled: true,
        agentTaskComplete: false,
        terminalBell: false,
        suppressWhenFocused: true,
        ...overrides
      }
    })
  }) as never

const question = (id: string) => ({
  source: 'game-owner-question',
  notificationId: `game-owner-question:${id}`,
  repoLabel: 'orca-oss',
  ownerQuestion: 'Ship the arcade in lab.111?',
  gameInbox: { environmentId: 'env-imac', worktreeId: 'repo::/w' }
})

describe('owner question notifications', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T16:00:00Z'))
    resetNotificationDispatchMocks()
  })

  it('shows the question even with agent notifications off, and not on the phone', async () => {
    const dispatchMobileNotification = vi.fn()
    registerNotificationHandlers(settings(), { dispatchMobileNotification } as never)

    expect(await getDispatchHandler()({}, question('oq_1'))).toEqual({ delivered: true })
    expect(notificationCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'orca-oss: the lead asks you',
        body: 'Ship the arcade in lab.111?'
      })
    )
    expect(dispatchMobileNotification).not.toHaveBeenCalled()
  })

  it('stays quiet when notifications are off', async () => {
    registerNotificationHandlers(settings({ enabled: false }))

    expect(await getDispatchHandler()({}, question('oq_1'))).toEqual({
      delivered: false,
      reason: 'disabled'
    })
  })

  it('shows two questions of one project asked back to back', async () => {
    registerNotificationHandlers(settings())

    await getDispatchHandler()({}, question('oq_1'))
    expect(await getDispatchHandler()({}, question('oq_2'))).toEqual({ delivered: true })
  })

  it('opens the Inbox on the question’s project when clicked', async () => {
    const send = vi.fn()
    getTrustedUIRendererWindowMock.mockReturnValue({
      isDestroyed: () => false,
      isMinimized: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send }
    })
    registerNotificationHandlers(settings())

    await getDispatchHandler()({}, question('oq_1'))
    getNotificationEventHandler('click')()

    expect(send).toHaveBeenCalledWith('ui:openGameInbox', {
      environmentId: 'env-imac',
      worktreeId: 'repo::/w'
    })
    expect(send).not.toHaveBeenCalledWith('ui:activateWorktree', expect.anything())
  })

  it('sets the dock badge to the open count where the platform has one', async () => {
    const platform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      registerNotificationHandlers(settings())
      getSetBadgeCountHandler()({}, 3)
      getSetBadgeCountHandler()({}, -1)
      getSetBadgeCountHandler()({}, 'x')
      Object.defineProperty(process, 'platform', { value: 'win32' })
      getSetBadgeCountHandler()({}, 5)
    } finally {
      Object.defineProperty(process, 'platform', { value: platform })
    }

    expect(appSetBadgeCountMock.mock.calls).toEqual([[3], [0], [0]])
  })
})
