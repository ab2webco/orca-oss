import { beforeEach, describe, expect, it, vi } from 'vitest'

const windows: { isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } }[] =
  []

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => windows }
}))

import {
  broadcastMobileInstallRequest,
  MOBILE_INSTALL_REQUEST_CHANNEL,
  MOBILE_INSTALL_RESTART_CHANNEL,
  requestRendererPreparedRestart
} from './updater-mobile-install-broadcast'

function makeWindow(destroyed = false): (typeof windows)[number] {
  return { isDestroyed: () => destroyed, webContents: { send: vi.fn() } }
}

describe('mobile install request broadcast', () => {
  beforeEach(() => {
    windows.length = 0
  })

  it('sends the request to every live window and skips destroyed ones', () => {
    const live = makeWindow()
    const gone = makeWindow(true)
    windows.push(live, gone)
    const request = {
      requestId: 'req-1',
      deviceName: 'Pixel 9',
      phase: 'countdown' as const,
      deadlineAt: 31_000
    }

    broadcastMobileInstallRequest(request)

    expect(live.webContents.send).toHaveBeenCalledWith(MOBILE_INSTALL_REQUEST_CHANNEL, request)
    expect(gone.webContents.send).not.toHaveBeenCalled()
  })

  it('tells the windows when the request ends', () => {
    const live = makeWindow()
    windows.push(live)

    broadcastMobileInstallRequest(null)

    expect(live.webContents.send).toHaveBeenCalledWith(MOBILE_INSTALL_REQUEST_CHANNEL, null)
  })

  it('asks the live windows to restart through their own save-and-quit path', () => {
    const live = makeWindow()
    const gone = makeWindow(true)
    windows.push(live, gone)

    expect(requestRendererPreparedRestart()).toBe(true)
    expect(live.webContents.send).toHaveBeenCalledWith(MOBILE_INSTALL_RESTART_CHANNEL)
    expect(gone.webContents.send).not.toHaveBeenCalled()
  })

  it('reports that no window could take the restart so the caller installs directly', () => {
    windows.push(makeWindow(true))

    expect(requestRendererPreparedRestart()).toBe(false)
  })
})
