import { app, screen, type BrowserWindow } from 'electron'

// ORCA-692 POC: a headless E2E window that still paints frames, for FPS soaks on a desk someone is
// using. It never activates the app, never takes focus, lets clicks through and keeps only a thin
// sliver on screen. Why a sliver and not fully off screen: a fully covered window gets no frames.
const SLIVER_PX = 24

export const isE2EBackgroundWindow = (): boolean => process.env.ORCA_E2E_BACKGROUND_WINDOW === '1'

export function revealE2EBackgroundWindow(window: BrowserWindow): void {
  if (process.platform === 'darwin') {
    app.setActivationPolicy('accessory')
  }
  const area = screen.getPrimaryDisplay().workArea
  const { width, height } = window.getBounds()
  window.setFocusable(false)
  window.setIgnoreMouseEvents(true)
  window.setBounds({
    x: area.x + area.width - SLIVER_PX,
    y: area.y + Math.max(0, area.height - height),
    width,
    height
  })
  window.showInactive()
}
