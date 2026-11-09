// ORCA-1131: the same "Claude finished" notification showed twice, 5.7 s and 14.8 s apart, because a
// second renderer path replayed the completion after the 5 s worktree cooldown had passed.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getDispatchHandler,
  notificationShowMock,
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

const completion = {
  source: 'agent-task-complete',
  worktreeId: 'repo::main',
  paneKey: 'tab-1:leaf-1',
  worktreeLabel: 'main',
  agentType: 'claude',
  agentState: 'done',
  agentPrompt: 'Run the command once',
  agentLastAssistantMessage: 'It ran once.'
} as const

describe('a replayed agent completion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-07T13:45:50Z'))
    resetNotificationDispatchMocks()
    registerNotificationHandlers({
      getSettings: () => ({
        notifications: {
          enabled: true,
          agentTaskComplete: true,
          terminalBell: true,
          suppressWhenFocused: false
        }
      })
    } as never)
  })

  it('shows once when the same completion arrives again 5.7 s and 14.8 s later', async () => {
    const handler = getDispatchHandler()

    expect(await handler({}, completion)).toEqual({ delivered: true })
    vi.advanceTimersByTime(5_700)
    expect(await handler({}, completion)).toEqual({ delivered: false, reason: 'cooldown' })
    vi.advanceTimersByTime(9_100)
    expect(await handler({}, completion)).toEqual({ delivered: false, reason: 'cooldown' })
    expect(notificationShowMock).toHaveBeenCalledTimes(1)
  })

  it('still shows the next turn of the same pane after the burst cooldown', async () => {
    const handler = getDispatchHandler()

    expect(await handler({}, completion)).toEqual({ delivered: true })
    vi.advanceTimersByTime(6_000)
    expect(
      await handler(
        {},
        {
          ...completion,
          agentPrompt: 'Now run it twice',
          agentLastAssistantMessage: 'It ran twice.'
        }
      )
    ).toEqual({ delivered: true })
    expect(notificationShowMock).toHaveBeenCalledTimes(2)
  })

  it('shows the same completion again once the repeat window has passed', async () => {
    const handler = getDispatchHandler()

    expect(await handler({}, completion)).toEqual({ delivered: true })
    vi.advanceTimersByTime(60_001)
    expect(await handler({}, completion)).toEqual({ delivered: true })
  })
})
