import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// Screenshot rig for ORCA-468. Delete once the images are read.
const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['dark', 'light'] as const

type PairingState = 'with-addresses' | 'no-address' | 'host-unsupported'
type StubInterface = { name: string; address: string }

async function stubPairingBackend(
  electronApp: ElectronApplication,
  interfaces: StubInterface[]
): Promise<void> {
  const { default: QRCode } = await import('qrcode')
  const pairingUrl = 'orca://pair?code=E2E468DEMO'
  const qrDataUrl = await QRCode.toDataURL(pairingUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 256
  })
  await electronApp.evaluate(
    ({ ipcMain }, fixture) => {
      ipcMain.removeHandler('mobile:listNetworkInterfaces')
      ipcMain.handle('mobile:listNetworkInterfaces', async () => ({
        interfaces: fixture.interfaces
      }))
      ipcMain.removeHandler('mobile:listDevices')
      ipcMain.handle('mobile:listDevices', async () => ({ devices: [] }))
      ipcMain.removeHandler('mobile:getPairingQR')
      ipcMain.handle('mobile:getPairingQR', async (_event, args?: { address?: string }) => {
        // Mirrors the real LAN rule: with nothing to advertise the host refuses rather than
        // minting a code the phone cannot use.
        const address = args?.address ?? fixture.interfaces[0]?.address
        if (!address) {
          return {
            available: false,
            reason: 'invalid_advertised_endpoint',
            guidance: 'No reachable network address is available for pairing.'
          }
        }
        return {
          available: true,
          qrDataUrl: fixture.qrDataUrl,
          pairingUrl: fixture.pairingUrl,
          endpoint: `ws://${address}:6768`,
          deviceId: 'e2e-device',
          connectionMode: 'local-only'
        }
      })
    },
    { interfaces, pairingUrl, qrDataUrl }
  )
}

async function resizeWindow(electronApp: ElectronApplication, width: number): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0]
    // Orca's desktop minimum is wider than a phone; lift it so 390/320 are real measurements.
    window?.setMinimumSize(300, 400)
    window?.setSize(size, 900)
  }, width)
}

async function openPairingStep(page: Page, state: PairingState): Promise<void> {
  await page.evaluate(async (asWebClient: boolean) => {
    await window.__store!.getState().updateSettings({
      mobilePairingConnectionMode: 'local-only',
      mobilePairingCustomAddress: null
    })
    // The web client's runtime IS the machine being paired, so that is the surface where an
    // older host turns the wizard into a dead end.
    ;(window as unknown as { __ORCA_WEB_CLIENT__?: boolean }).__ORCA_WEB_CLIENT__ = asWebClient
    // The left sidebar is fixed-width, so the pairing screen only gets the viewport it is
    // being measured at once the sidebar is out of the way.
    window.__store!.getState().setSidebarOpen(false)
    window.__store!.getState().openMobilePage()
  }, state === 'host-unsupported')
  await page.getByRole('button', { name: /Get started/i }).click()
  await page.getByRole('button', { name: /^Continue$/i }).click()
  await expect(page.getByText('Step 2 of 2')).toBeVisible()
}

async function capture(
  page: Page,
  electronApp: ElectronApplication,
  testInfo: TestInfo,
  state: PairingState
): Promise<void> {
  for (const theme of THEMES) {
    await page.evaluate(async (next) => {
      await window.__store!.getState().updateSettings({ theme: next })
    }, theme)
    for (const width of WIDTHS) {
      await resizeWindow(electronApp, width)
      await page.waitForTimeout(400)
      await page.screenshot({ path: testInfo.outputPath(`${state}-${theme}-${width}.png`) })
    }
  }
}

async function enterFlow(
  page: Page,
  electronApp: ElectronApplication,
  interfaces: StubInterface[],
  state: PairingState
): Promise<void> {
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await stubPairingBackend(electronApp, interfaces)
  await resizeWindow(electronApp, 1440)
  await openPairingStep(page, state)
}

test('ORCA-468 pairing wizard: host with addresses mints a QR', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  await enterFlow(
    orcaPage,
    electronApp,
    [
      { name: 'en0', address: '192.168.10.105' },
      { name: 'tailscale0', address: '100.126.117.25' }
    ],
    'with-addresses'
  )
  await expect(orcaPage.locator('.mp-qr-large img')).toBeVisible({ timeout: 20_000 })
  await capture(orcaPage, electronApp, testInfo, 'with-addresses')
})

test('ORCA-468 pairing wizard: LAN with no address refuses instead of inviting a retry', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  await enterFlow(orcaPage, electronApp, [], 'no-address')
  await expect(orcaPage.getByText(/No network address to put in the code/i)).toBeVisible({
    timeout: 20_000
  })
  await expect(orcaPage.getByRole('button', { name: /Generate code/i })).toBeDisabled()
  await capture(orcaPage, electronApp, testInfo, 'no-address')
})

// The host is launched without pairing.mobile-qr.v1, which is what an older Orca answers.
test.describe('against a host without the pairing RPC', () => {
  test.use({ orcaAppExtraEnv: { ORCA_E2E_DISABLE_PAIRING_MOBILE_QR: '1' } })

  test('ORCA-468 pairing wizard: a host that cannot mint says so', async ({
    orcaPage,
    electronApp
  }, testInfo) => {
    await enterFlow(orcaPage, electronApp, [], 'host-unsupported')
    await expect(orcaPage.getByText(/Pairing can.t be set up from here/i)).toBeVisible({
      timeout: 30_000
    })
    await expect(orcaPage.getByRole('button', { name: 'Refresh network interfaces' })).toHaveCount(
      0
    )
    await capture(orcaPage, electronApp, testInfo, 'host-unsupported')
  })
})
