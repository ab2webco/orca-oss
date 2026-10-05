import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NotificationSettings } from '../../shared/notification-settings-types'
import {
  NOTIFICATION_DISPATCHED_BODY_MAX_LENGTH,
  NOTIFICATION_DISPATCHED_TITLE_MAX_LENGTH,
  notificationDispatchedPayloadSchema
} from '../../shared/plugins/plugin-events'
import type { MobileNotificationEvent } from '../runtime/orca-runtime'
import { forwardOrcaNotificationsToPlugins } from '../plugins/plugin-notification-event-bridge'
import {
  getAllWindowsMock,
  getDispatchHandler,
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

const NOW = new Date('2026-03-28T16:00:00Z').getTime()

/** The runtime's notification fan-out, without the rest of the runtime. */
function notificationBus() {
  const listeners = new Set<(event: MobileNotificationEvent) => void>()
  return {
    onNotificationDispatched(listener: (event: MobileNotificationEvent) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatchMobileNotification(event: MobileNotificationEvent): void {
      for (const listener of listeners) {
        listener(event)
      }
    }
  }
}

function setup(notifications: Partial<NotificationSettings> = {}) {
  const bus = notificationBus()
  const emit = vi.fn()
  forwardOrcaNotificationsToPlugins(bus, emit)
  registerNotificationHandlers(
    {
      getSettings: () => ({
        notifications: {
          enabled: true,
          agentTaskComplete: true,
          terminalBell: true,
          suppressWhenFocused: false,
          ...notifications
        }
      })
    } as never,
    bus as never
  )
  return { bus, emit, handler: getDispatchHandler() }
}

describe('notification.dispatched at the notifications:dispatch decision point', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    resetNotificationDispatchMocks()
  })

  it('emits what Orca chose to notify, after its switches', async () => {
    const { emit, handler } = setup()
    await handler(
      {},
      {
        source: 'agent-task-complete',
        worktreeId: 'repo::wt1',
        worktreeLabel: 'feat/notis',
        agentType: 'claude',
        agentState: 'waiting',
        agentPrompt: 'never forwarded',
        agentLastAssistantMessage: 'Should I run the migration?'
      }
    )

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({
      source: 'agent-task-complete',
      worktreeId: 'repo::wt1',
      title: 'feat/notis - Claude needs input',
      body: 'Should I run the migration?',
      at: NOW
    })
  })

  it('reports a notification without a worktree as a null worktreeId', async () => {
    const { emit, handler } = setup()
    await handler({}, { source: 'terminal-bell' })
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ worktreeId: null }))
  })

  it('does not emit when notifications are disabled', async () => {
    const { emit, handler } = setup({ enabled: false })
    await handler({}, { source: 'agent-task-complete', worktreeId: 'repo::wt1' })
    expect(emit).not.toHaveBeenCalled()
  })

  it('does not emit for a source Orca has switched off', async () => {
    const { emit, handler } = setup({ agentTaskComplete: false, terminalBell: false })
    await handler({}, { source: 'agent-task-complete', worktreeId: 'repo::wt1' })
    await handler({}, { source: 'terminal-bell', worktreeId: 'repo::wt2' })
    expect(emit).not.toHaveBeenCalled()
  })

  it('does not emit the Settings test notification, like the mobile relay', async () => {
    const { emit, handler } = setup()
    await handler({}, { source: 'test' })
    expect(emit).not.toHaveBeenCalled()
  })

  it('emits once per burst, like the mobile relay', async () => {
    const { emit, handler } = setup()
    await handler({}, { source: 'agent-task-complete', worktreeId: 'repo::wt1' })
    await handler({}, { source: 'terminal-bell', worktreeId: 'repo::wt1' })
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('still emits when the desktop suppresses the banner because the worktree is focused', async () => {
    getAllWindowsMock.mockReturnValue([
      { isDestroyed: () => false, isFocused: () => true } as never
    ])
    const { emit, handler } = setup({ suppressWhenFocused: true })
    expect(
      await handler(
        {},
        { source: 'agent-task-complete', worktreeId: 'repo::wt1', isActiveWorktree: true }
      )
    ).toEqual({ delivered: false, reason: 'suppressed-focus' })
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('never re-emits a plugin notification or a dismissal', () => {
    const { bus, emit } = setup()
    bus.dispatchMobileNotification({
      type: 'notification',
      source: 'plugin',
      title: 'orca-samples.relay: hi',
      body: ''
    })
    bus.dispatchMobileNotification({ type: 'dismiss', notificationId: 'agent:one' })
    expect(emit).not.toHaveBeenCalled()
  })

  it('bounds title and body so the payload always passes the event schema', async () => {
    const { emit, handler } = setup()
    await handler(
      {},
      {
        source: 'terminal-bell',
        worktreeId: 'repo::wt1',
        worktreeLabel: 'w'.repeat(5000),
        repoLabel: 'r'.repeat(5000)
      }
    )
    const payload = emit.mock.calls[0]?.[0] as { title: string; body: string }
    expect(payload.title.length).toBeLessThanOrEqual(NOTIFICATION_DISPATCHED_TITLE_MAX_LENGTH)
    expect(payload.body.length).toBeLessThanOrEqual(NOTIFICATION_DISPATCHED_BODY_MAX_LENGTH)
    expect(payload.title.endsWith('…')).toBe(true)
    expect(notificationDispatchedPayloadSchema.safeParse(payload).success).toBe(true)
  })
})
