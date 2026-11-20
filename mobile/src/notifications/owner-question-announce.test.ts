import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { onOwnerQuestion, type OwnerQuestionArrival } from '../game-inbox/owner-question-arrivals'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import { resetHostNotificationSessionsForTests } from './notification-reconnect-catchup'

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(async () => ({ status: 'denied', canAskAgain: false })),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  dismissNotificationAsync: vi.fn()
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios', Version: 18 } }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) }
}))
vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: vi.fn(async () => false)
}))

beforeEach(() => resetHostNotificationSessionsForTests())

describe('owner-question announcements (ORCA-1306)', () => {
  it('tells an open Team sheet about a live owner question, and about nothing else', () => {
    let onEvent: (data: unknown) => void = () => {}
    const client = {
      subscribe: vi.fn((_method, _params, callback: (data: unknown) => void) => {
        onEvent = callback
        return vi.fn()
      }),
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn()
    } as unknown as RpcClient
    const heard: OwnerQuestionArrival[] = []
    const stop = onOwnerQuestion((arrival) => heard.push(arrival))
    const unsubscribe = subscribeToDesktopNotifications(client, 'host-1')
    const event = { type: 'notification', title: 'lumen-app: the lead asks you', body: 'Ship?' }

    onEvent({ ...event, source: 'agent-task-complete', worktreeId: 'repo::/main' })
    onEvent({ ...event, source: 'game-owner-question', worktreeId: 'repo::/main' })
    onEvent({ ...event, source: 'game-owner-question' })

    expect(heard).toEqual([{ worktreeId: 'repo::/main' }, { worktreeId: null }])
    stop()
    unsubscribe()
  })
})
