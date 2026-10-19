import { describe, expect, it, vi } from 'vitest'
import {
  cancelRemoteServerMobileInstall,
  checkRemoteServerUpdater,
  configureRemoteServerUpdater,
  downloadRemoteServerUpdater,
  getRemoteServerMobileInstallRequest,
  getRemoteServerUpdaterSnapshot,
  installRemoteServerUpdater,
  restartRemoteServerMobileInstallNow
} from './remote-server-updater'

describe('remote server updater adapter', () => {
  it('defaults to a safe manual-only implementation', () => {
    expect(getRemoteServerUpdaterSnapshot('runtime-1')).toMatchObject({
      runtimeId: 'runtime-1',
      support: { automatic: false, reason: 'updater-unavailable' }
    })
    expect(() => checkRemoteServerUpdater('runtime-1')).toThrow('remote_update_manual_required')
    expect(() => downloadRemoteServerUpdater('runtime-1')).toThrow('remote_update_manual_required')
    expect(() => installRemoteServerUpdater('runtime-1')).toThrow('remote_update_manual_required')
  })

  it('passes the runtime identity through every configured operation', () => {
    const snapshot = {
      appVersion: '1.5.0',
      runtimeId: 'runtime-2',
      support: { installMode: 'interactive', automatic: true, reason: 'available' },
      status: { state: 'available', version: '1.5.1', changelog: null }
    } as const
    const getSnapshot = vi.fn(() => snapshot)
    const check = vi.fn(() => snapshot)
    const download = vi.fn(() => snapshot)
    const install = vi.fn(() => ({
      accepted: true as const,
      fromVersion: '1.5.0',
      targetVersion: '1.5.1',
      runtimeId: 'runtime-2'
    }))
    configureRemoteServerUpdater({
      getSnapshot,
      check,
      download,
      install,
      requestMobileInstall: vi.fn(),
      cancelMobileInstall: vi.fn(() => false),
      restartMobileInstallNow: vi.fn(() => false),
      getMobileInstallRequest: () => null
    })

    expect(getRemoteServerUpdaterSnapshot('runtime-2')).toEqual({
      ...snapshot,
      mobileInstallRequest: null
    })
    expect(checkRemoteServerUpdater('runtime-2')).toBe(snapshot)
    expect(downloadRemoteServerUpdater('runtime-2')).toBe(snapshot)
    expect(installRemoteServerUpdater('runtime-2').accepted).toBe(true)
    expect([getSnapshot, check, download, install].map((fn) => fn.mock.calls[0])).toEqual([
      ['runtime-2'],
      ['runtime-2'],
      ['runtime-2'],
      ['runtime-2']
    ])
  })

  it('lets the desktop dialog read, cancel and fast-forward the pending phone request', () => {
    const pending = {
      requestId: 'req-1',
      deviceName: 'Pixel 9',
      phase: 'countdown' as const,
      deadlineAt: 31_000
    }
    const cancelMobileInstall = vi.fn(() => true)
    const restartMobileInstallNow = vi.fn(() => true)
    configureRemoteServerUpdater({
      getSnapshot: vi.fn(),
      check: vi.fn(),
      download: vi.fn(),
      install: vi.fn(),
      requestMobileInstall: vi.fn(),
      cancelMobileInstall,
      restartMobileInstallNow,
      getMobileInstallRequest: () => pending
    })

    expect(getRemoteServerMobileInstallRequest()).toBe(pending)
    expect(cancelRemoteServerMobileInstall('req-1')).toBe(true)
    expect(restartRemoteServerMobileInstallNow('req-1')).toBe(true)
    expect(cancelMobileInstall).toHaveBeenCalledWith('req-1')
    expect(restartMobileInstallNow).toHaveBeenCalledWith('req-1')
  })
})
