import { describe, expect, it, vi } from 'vitest'
import {
  registerMobileInstallRequestIpc,
  type MobileInstallRequestIpcDeps
} from './updater-mobile-install-ipc'

type Handler = (event: { sender: string }, ...args: unknown[]) => unknown

function setup(overrides: Partial<MobileInstallRequestIpcDeps> = {}) {
  const handlers = new Map<string, Handler>()
  const removed: string[] = []
  const pending = {
    requestId: 'req-1',
    deviceName: 'Pixel 9',
    phase: 'countdown' as const,
    deadlineAt: 31_000
  }
  const deps: MobileInstallRequestIpcDeps = {
    ipc: {
      handle: (channel, handler) => handlers.set(channel, handler as Handler),
      removeHandler: (channel) => removed.push(channel)
    },
    isTrustedSender: (sender) => sender === 'ui',
    getRequest: () => pending,
    cancel: vi.fn(() => true),
    restartNow: vi.fn(() => true),
    ...overrides
  }
  registerMobileInstallRequestIpc(deps)
  return { handlers, removed, deps, pending }
}

describe('mobile install request IPC', () => {
  it('lets a window that mounts late read the pending request', () => {
    const { handlers, pending } = setup()

    expect(handlers.get('updater:getMobileInstallRequest')?.({ sender: 'ui' })).toBe(pending)
  })

  it('relays Cancel and Restart now from the trusted app window', () => {
    const { handlers, deps } = setup()

    expect(handlers.get('updater:cancelMobileInstall')?.({ sender: 'ui' }, 'req-1')).toBe(true)
    expect(handlers.get('updater:restartMobileInstallNow')?.({ sender: 'ui' }, 'req-1')).toBe(true)
    expect(deps.cancel).toHaveBeenCalledWith('req-1')
    expect(deps.restartNow).toHaveBeenCalledWith('req-1')
  })

  it('refuses to restart or cancel from a sender that is not the app window', () => {
    const { handlers, deps } = setup()

    expect(() =>
      handlers.get('updater:restartMobileInstallNow')?.({ sender: 'guest' }, 'req-1')
    ).toThrow('Unauthorized mobile install sender')
    expect(() =>
      handlers.get('updater:cancelMobileInstall')?.({ sender: 'guest' }, 'req-1')
    ).toThrow('Unauthorized mobile install sender')
    expect(deps.restartNow).not.toHaveBeenCalled()
    expect(deps.cancel).not.toHaveBeenCalled()
  })

  it('rejects a request id that is not a non-empty string', () => {
    const { handlers, deps } = setup()

    expect(() => handlers.get('updater:restartMobileInstallNow')?.({ sender: 'ui' }, 42)).toThrow(
      'Invalid mobile install request id'
    )
    expect(() => handlers.get('updater:cancelMobileInstall')?.({ sender: 'ui' }, '')).toThrow(
      'Invalid mobile install request id'
    )
    expect(deps.restartNow).not.toHaveBeenCalled()
    expect(deps.cancel).not.toHaveBeenCalled()
  })

  it('clears earlier registrations so a re-registration does not throw', () => {
    const { removed } = setup()

    expect(removed).toEqual([
      'updater:getMobileInstallRequest',
      'updater:cancelMobileInstall',
      'updater:restartMobileInstallNow'
    ])
  })
})
