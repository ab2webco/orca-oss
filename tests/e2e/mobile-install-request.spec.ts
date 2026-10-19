/**
 * Invariant: a paired phone can only ask for an install after the desktop opts in, and the
 * desktop countdown names the device and lets Cancel and Restart now reach main (ORCA-612).
 * Needs E2E: the dialog is pushed over the real preload channel and its buttons must round-trip
 * through the real renderer → IPC wiring; a mounted-component test mocks both ends.
 */

import type { Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const WIDTHS = [1440, 768] as const
const THEMES = ['dark', 'light'] as const

/** Drives the real setting so the whole window repaints, not just the root class. */
async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

/** The open animation scales and fades the dialog in: a screenshot mid-animation is not what users see. */
async function waitForDialogSettled(dialog: Locator): Promise<void> {
  await expect
    .poll(async () =>
      dialog.evaluate((node) => {
        const style = getComputedStyle(node)
        return [new DOMMatrixReadOnly(style.transform).a, Number(style.opacity)]
      })
    )
    .toEqual([1, 1])
}

async function pushRequest(
  electronApp: Parameters<Parameters<typeof test>[2]>[0]['electronApp'],
  request: {
    requestId: string
    deviceName: string
    phase: string
    deadlineAt: number | null
  } | null
): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, payload) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('updater:mobileInstallRequest', payload)
    }
  }, request)
}

test('the opt-in is off by default and the switch saves it', async ({
  orcaPage
}, testInfo: TestInfo) => {
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    state.openSettingsTarget({ pane: 'general', repoId: null })
    state.openSettingsPage()
  })
  const toggle = orcaPage.getByRole('switch', { name: 'Update from a paired phone' })
  await toggle.scrollIntoViewIfNeeded()
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(
    await orcaPage.evaluate(() => window.__store?.getState().settings?.allowMobileUpdateInstall)
  ).toBeFalsy()

  for (const width of WIDTHS) {
    await orcaPage.setViewportSize({ width, height: 900 })
    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      await toggle.scrollIntoViewIfNeeded()
      await orcaPage.screenshot({
        path: testInfo.outputPath(`opt-in-off-${width}-${theme}.png`)
      })
    }
  }

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect
    .poll(() =>
      orcaPage.evaluate(() => window.__store?.getState().settings?.allowMobileUpdateInstall)
    )
    .toBe(true)
  await orcaPage.screenshot({ path: testInfo.outputPath('opt-in-on-768-light.png') })
})

test('the countdown names the phone and Cancel and Restart now reach main', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  await electronApp.evaluate(({ ipcMain }) => {
    const calls: { channel: string; requestId: unknown }[] = []
    ;(globalThis as { __mobileInstallCalls?: typeof calls }).__mobileInstallCalls = calls
    for (const channel of ['updater:cancelMobileInstall', 'updater:restartMobileInstallNow']) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, requestId: unknown) => {
        calls.push({ channel, requestId })
        return true
      })
    }
  })
  const recorded = (): Promise<{ channel: string; requestId: unknown }[]> =>
    electronApp.evaluate(
      () =>
        (globalThis as { __mobileInstallCalls?: { channel: string; requestId: unknown }[] })
          .__mobileInstallCalls ?? []
    )

  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  const dialog = orcaPage.getByRole('dialog', { name: /asked to update Orca Lab/ })
  await expect(dialog).toHaveCount(0)

  await pushRequest(electronApp, {
    requestId: 'req-e2e-1',
    deviceName: 'Pixel 9 Pro XL',
    phase: 'countdown',
    deadlineAt: Date.now() + 45_000
  })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog).toContainText('Pixel 9 Pro XL')
  await expect(dialog).toContainText(/in \d+s/)
  await waitForDialogSettled(dialog)

  for (const width of WIDTHS) {
    await orcaPage.setViewportSize({ width, height: 900 })
    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      const box = await dialog.boundingBox()
      expect(box, `${width}px ${theme}: dialog has no box`).not.toBeNull()
      expect(box!.x, `${width}px ${theme}: dialog clipped on the left`).toBeGreaterThanOrEqual(0)
      expect(
        box!.x + box!.width,
        `${width}px ${theme}: dialog wider than the window`
      ).toBeLessThanOrEqual(width)
      await orcaPage.screenshot({ path: testInfo.outputPath(`countdown-${width}-${theme}.png`) })
    }
  }

  await dialog.getByRole('button', { name: 'Restart now' }).click()
  await expect
    .poll(recorded)
    .toEqual([{ channel: 'updater:restartMobileInstallNow', requestId: 'req-e2e-1' }])

  await pushRequest(electronApp, null)
  await expect(dialog).toHaveCount(0)

  await pushRequest(electronApp, {
    requestId: 'req-e2e-2',
    deviceName: 'Pixel 9 Pro XL',
    phase: 'downloading',
    deadlineAt: null
  })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog.getByRole('button', { name: 'Restart now' })).toHaveCount(0)
  await orcaPage.setViewportSize({ width: 768, height: 900 })
  await setTheme(orcaPage, 'dark')
  await waitForDialogSettled(dialog)
  await orcaPage.screenshot({ path: testInfo.outputPath('downloading-768-dark.png') })

  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(recorded).toEqual([
    { channel: 'updater:restartMobileInstallNow', requestId: 'req-e2e-1' },
    { channel: 'updater:cancelMobileInstall', requestId: 'req-e2e-2' }
  ])
})
