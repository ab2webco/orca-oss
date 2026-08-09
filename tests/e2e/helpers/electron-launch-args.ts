import { dirname } from 'node:path'

export function getOrcaElectronLaunchArgs(mainPath: string, headful: boolean): string[] {
  // Launch through package.json so app version and resource paths match a packaged app.
  const appPath = dirname(dirname(dirname(mainPath)))
  if (headful || process.platform !== 'linux') {
    return [appPath]
  }

  // Why: Ubuntu CI cannot run Electron's setuid chrome-sandbox (not root-owned
  // mode 4755 in node_modules). Playwright's electron.launch injects
  // --no-sandbox automatically; raw spawn() paths (e.g. second-instance
  // activation) must match or Chromium aborts with SIGTRAP before handshake.
  // GPU flags keep headless under Xvfb on a software path when the GPU
  // subprocess cannot initialize.
  // Why the backgrounding flags: headless E2E never calls mainWindow.show(),
  // so Chromium classifies the renderer as occluded and stops delivering
  // animation frames. Playwright's click actionability gate and any
  // rAF-based responsiveness probe then measure the harness, not the app —
  // a click on a perfectly rendered button hangs its full timeout.
  return [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--disable-gpu-sandbox',
    '--disable-dev-shm-usage',
    '--in-process-gpu',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    appPath
  ]
}
