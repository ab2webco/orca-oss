import { BrowserWindow } from 'electron'
import type { MobileInstallRequestState } from '../shared/remote-server-update'

export const MOBILE_INSTALL_REQUEST_CHANNEL = 'updater:mobileInstallRequest'
export const MOBILE_INSTALL_RESTART_CHANNEL = 'updater:mobileInstallRestart'

function liveWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
}

// Why: every window shows the countdown, so whichever one the user is looking at can cancel it.
export function broadcastMobileInstallRequest(state: MobileInstallRequestState | null): void {
  for (const window of liveWindows()) {
    window.webContents.send(MOBILE_INSTALL_REQUEST_CHANNEL, state)
  }
}

// Why: the window's own restart backs up dirty editors first; a main-only quit would skip that.
export function requestRendererPreparedRestart(): boolean {
  const windows = liveWindows()
  for (const window of windows) {
    window.webContents.send(MOBILE_INSTALL_RESTART_CHANNEL)
  }
  return windows.length > 0
}
