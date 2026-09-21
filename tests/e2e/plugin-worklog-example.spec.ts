/**
 * Invariant: the `worklog` example — the plugin the authoring guide tells people
 * to copy — installs, gates behind consent, mounts its settings-surface panel,
 * and round-trips storage through the panel bridge.
 * Needs E2E: the panel is an opaque-origin sandboxed iframe whose only route to
 * the host is postMessage, so nothing below the real app exercises it.
 */

import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, FrameLocator, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const PANEL_TITLE = 'Worklog'
const PANEL_ENTRY_TEXT = 'shipped the plugin guide'
const RETRY_ENTRY_TEXT = 'saved through a spent bridge budget'
const AUTOMATION_COMMAND = "require('fs').appendFileSync('worklog-digest.log'"
const SCREENSHOT_WIDTHS = [1440, 768, 390, 320]

/** Drives the real setting so the whole window repaints, not just the root
 *  class — the panel's tokens are re-injected from the live document. */
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

/** The main window floors at 600px, so phone widths need the floor lifted. */
async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

function panelFrame(page: Page): FrameLocator {
  return page.frameLocator(`iframe[title="${PANEL_TITLE}"]`)
}

/**
 * A rebuilt frame reloads its data over the bridge, and a capture matrix rebuilds
 * it 16 times — enough resizes, pongs and reloads to spend the 30-messages-per-10s
 * budget. The panel says so instead of painting an empty log, which is the whole
 * point of branching on `ok`; retrying past the window is what a user would do.
 */
async function waitForPanelData(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const status = await panelFrame(page).locator('#status').innerText()
        if (status !== '') {
          await panelFrame(page).getByRole('button', { name: 'Refresh' }).click()
        }
        return panelFrame(page).locator('#entries').innerText()
      },
      { timeout: 60_000, intervals: [250, 1_000, 3_000, 6_000, 6_000, 6_000] }
    )
    .toContain(PANEL_ENTRY_TEXT)
}

/**
 * Spends the plugin's bridge budget from inside the frame. Every message the
 * panel window sends is charged before the host even parses it
 * (plugin-panel-bridge-host.ts:115), so junk frames are enough — and the sender
 * has to be the panel window, which is why this runs in the frame.
 */
async function saturateBridge(page: Page): Promise<void> {
  await panelFrame(page)
    .locator('body')
    .evaluate((body) => {
      const view = body.ownerDocument.defaultView
      // No requestId: the host charges the budget and answers nothing, so the
      // flood cannot be mistaken for the panel's own traffic.
      for (let index = 0; index < 40; index++) {
        view?.parent.postMessage({ type: 'worklog-e2e-flood' }, '*')
      }
    })
}

/**
 * Makes every bridge reply go missing, from inside the panel.
 *
 * Simulating this host-side is not available to a test: the preload surface is
 * deeply frozen (`writable: false, configurable: false`), and a well-formed
 * request always gets an answer. What a panel can be made to do is wait for one
 * that never comes — which is the same promise that never settles, and the same
 * frozen UI. The name patched here is the panel's transport, deliberately kept
 * separate from the deadline that wraps it so this case stays reachable.
 */
async function swallowBridgeReplies(page: Page): Promise<void> {
  await panelFrame(page)
    .locator('body')
    .evaluate((body) => {
      const view = body.ownerDocument.defaultView as (Window & { callOnce?: unknown }) | null
      if (typeof view?.callOnce !== 'function') {
        throw new Error('panel transport `callOnce` is not reachable — control cannot run')
      }
      view.callOnce = () => new Promise(() => {})
    })
}

test('installs, consents, mounts and round-trips the worklog example plugin', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  // 16 captures, each waiting out a bridge window when the budget is spent.
  test.setTimeout(300_000)
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-worklog-example-e2e-'))
  const pluginRoot = join(tempRoot, 'worklog')
  await cp(join(process.cwd(), 'examples', 'plugins', 'worklog'), pluginRoot, { recursive: true })

  try {
    const installed = await orcaPage.evaluate(async (sourcePath) => {
      const settings = await window.api.settings.set({ pluginSystemEnabled: true })
      window.__store?.setState({ settings })
      const result = await window.api.plugins.install({ kind: 'local-path', path: sourcePath })
      if (!result.ok) {
        throw new Error(result.error)
      }
      const entry = (await window.api.plugins.refresh()).find(
        (candidate) => candidate.pluginKey === result.pluginKey
      )
      let blocked = false
      try {
        await window.api.plugins.invokeCommand({
          pluginKey: result.pluginKey,
          commandId: 'worklog.note'
        })
      } catch {
        blocked = true
      }
      return {
        pluginKey: result.pluginKey,
        status: entry?.status ?? 'missing',
        capabilities: entry?.capabilities.length ?? -1,
        panels: entry?.panels.map((panel) => panel.surface) ?? [],
        automations: entry?.automations?.length ?? -1,
        settings: entry?.settings?.length ?? -1,
        blocked
      }
    }, pluginRoot)

    // Everything the guide claims this example exercises, read off the wire.
    expect(installed.status).toBe('pending')
    expect(installed.blocked).toBe(true)
    expect(installed).toMatchObject({
      capabilities: 6,
      panels: ['settings'],
      automations: 1,
      settings: 4
    })

    await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('store unavailable')
      }
      state.openSettingsTarget({ pane: 'plugins', repoId: null })
      state.openSettingsPage()
    })
    await expect(orcaPage.locator('[data-settings-section="plugins"]')).toBeVisible()
    await orcaPage.getByRole('tab', { name: /^Installed/ }).click()
    const row = orcaPage.locator(`[data-plugin-key="${installed.pluginKey}"]`)
    await expect(row).toContainText('Needs review')
    await row.getByRole('button', { name: 'Review & enable' }).click()

    // "…and content", not the capability-only "Review permissions": a
    // contributed automation is instructional content, so the dialog also shows
    // the schedule and the shell string verbatim.
    const consent = orcaPage.getByRole('dialog', { name: 'Review access and content' })
    await expect(consent).toBeVisible()
    await expect(consent).toContainText(AUTOMATION_COMMAND)
    await expect(consent).toContainText('0 18 * * 1-5')
    await consent.getByRole('button', { name: 'Enable plugin' }).click()
    await expect(consent).toBeHidden()
    await expect(row).toContainText('Enabled')

    // Worker: lazy until invoked, then it publishes the settings mirror the
    // panel reads — the whole reason the mirror pattern exists.
    const published = await orcaPage.evaluate(
      async (pluginKey) =>
        window.api.plugins.invokeCommand({ pluginKey, commandId: 'worklog.publish-settings' }),
      installed.pluginKey
    )
    expect(published).toMatchObject({ author: 'me', recordNewWorktrees: true, maxEntries: 50 })

    const panelRow = orcaPage.getByRole('button', { name: PANEL_TITLE, exact: true })
    await expect(panelRow).toBeVisible({ timeout: 15_000 })
    await panelRow.click()
    await expect(orcaPage.locator(`iframe[title="${PANEL_TITLE}"]`)).toBeVisible({
      timeout: 15_000
    })
    // The mirror reaching the panel proves storage.get works over the bridge.
    await expect(panelFrame(orcaPage).locator('#settings')).toContainText('Author')
    await expect(panelFrame(orcaPage).locator('#settings-empty')).toBeHidden()

    // storage.set over the bridge, then a re-read that has to come back from
    // main: reloading the panel discards every bit of in-frame state.
    await panelFrame(orcaPage).locator('#entry').fill(PANEL_ENTRY_TEXT)
    await panelFrame(orcaPage).getByRole('button', { name: 'Add entry' }).click()
    await expect(panelFrame(orcaPage).locator('#status')).toHaveText('Saved.')
    await setTheme(orcaPage, 'dark')
    await expect(panelFrame(orcaPage).locator('#entries')).toContainText(PANEL_ENTRY_TEXT)

    // CONTROL A — a refused click must say so and then land anyway.
    // This is the defect that broke CI: the old panel reported the refusal and
    // abandoned the write, so the entry never arrived and the UI never said the
    // click had been dropped. The budget is a sliding 10s window, so the retry
    // genuinely has to outlast it; the assertion still demands the real success.
    await saturateBridge(orcaPage)
    await panelFrame(orcaPage).locator('#entry').fill(RETRY_ENTRY_TEXT)
    await panelFrame(orcaPage).getByRole('button', { name: 'Add entry' }).click()
    await expect(panelFrame(orcaPage).locator('#status')).toContainText('retrying', {
      timeout: 15_000
    })
    await orcaPage.screenshot({
      path: testInfo.outputPath('control-a-retrying.png'),
      animations: 'disabled'
    })
    // 4 attempts × 3.5s of backoff plus the calls themselves; the text asserted
    // is still exactly the success, never "success or an error".
    await expect(panelFrame(orcaPage).locator('#status')).toHaveText('Saved.', {
      timeout: 40_000
    })
    await expect(panelFrame(orcaPage).locator('#entries')).toContainText(RETRY_ENTRY_TEXT)
    await expect(panelFrame(orcaPage).locator('#entry')).toHaveValue('')

    for (const width of SCREENSHOT_WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(orcaPage, theme)
        const frame = orcaPage.locator(`iframe[title="${PANEL_TITLE}"]`)
        await expect(frame).toBeVisible()
        // A settings-surface frame is sized by the height the panel reports, and
        // a theme change rebuilds the document — so the shot has to wait for the
        // new frame to stop growing, or it catches a clipped panel with its own
        // scrollbar and proves nothing about the layout.
        await expect
          .poll(
            async () =>
              panelFrame(orcaPage)
                .locator('body')
                .evaluate((body) => {
                  const root = body.ownerDocument.documentElement
                  return root.scrollHeight - root.clientHeight
                }),
            { timeout: 10_000, message: `panel frame stayed clipped at ${width}px` }
          )
          .toBeLessThanOrEqual(1)
        // A screenshot of a panel clipped sideways would still look fine in the
        // thumbnail; measure inside the frame, which is the only place that can.
        const overflow = await panelFrame(orcaPage)
          .locator('body')
          .evaluate((body) => {
            const limit = body.clientWidth
            const widest = Array.from(body.querySelectorAll<HTMLElement>('*'))
              .map((node) => ({
                tag: node.tagName.toLowerCase() + (node.id ? `#${node.id}` : ''),
                width: node.getBoundingClientRect().width
              }))
              .sort((a, b) => b.width - a.width)[0]
            return { overflowX: body.scrollWidth - limit, frameWidth: limit, widest }
          })
        // Name the culprit: at these widths the Settings column is narrow
        // enough that one unshrinkable element is the whole failure.
        expect(
          overflow.overflowX,
          `panel overflows at ${width}px (frame ${overflow.frameWidth}px, widest ${JSON.stringify(overflow.widest)})`
        ).toBeLessThanOrEqual(1)
        await waitForPanelData(orcaPage)
        await orcaPage.screenshot({
          path: testInfo.outputPath(`worklog-panel-${width}-${theme}.png`),
          animations: 'disabled'
        })
      }
    }

    // The app shots above are of the Settings page, whose sidebar is fixed: at a
    // 390px window the panel is handed ~80px, so they say nothing about the
    // panel's own layout at 390. Widen the window until the FRAME is the target
    // width, then photograph the frame itself.
    const frameWidthOf = async (): Promise<number> =>
      panelFrame(orcaPage)
        .locator('body')
        .evaluate((body) => body.ownerDocument.documentElement.clientWidth)

    for (const frameWidth of SCREENSHOT_WIDTHS) {
      let windowWidth = frameWidth + 360
      let achieved = 0
      for (let attempt = 0; attempt < 4; attempt++) {
        await setWindowWidth(electronApp, orcaPage, Math.round(windowWidth))
        achieved = await frameWidthOf()
        if (Math.abs(achieved - frameWidth) <= 2) {
          break
        }
        windowWidth += frameWidth - achieved
      }
      // The widest target needs a window wider than the display allows, so the
      // shot is named by what the frame really was — never by what was asked for.
      expect(achieved, `could not narrow the panel to ${frameWidth}px`).toBeLessThanOrEqual(
        frameWidth + 2
      )
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(orcaPage, theme)
        await expect
          .poll(async () =>
            panelFrame(orcaPage)
              .locator('body')
              .evaluate((body) => {
                const root = body.ownerDocument.documentElement
                return root.scrollHeight - root.clientHeight
              })
          )
          .toBeLessThanOrEqual(1)
        await waitForPanelData(orcaPage)
        await orcaPage.locator(`iframe[title="${PANEL_TITLE}"]`).screenshot({
          path: testInfo.outputPath(`worklog-frame-${achieved}-${theme}.png`),
          animations: 'disabled'
        })
      }
    }
    // CONTROL B — silence is not an acceptable outcome.
    // A reply that never arrives used to leave the panel on "Saving…" forever:
    // a failure with no error message anywhere. This runs last because it
    // leaves the frame's transport patched; the next theme change rebuilds it.
    await setWindowWidth(electronApp, orcaPage, 1440)
    await setTheme(orcaPage, 'light')
    await waitForPanelData(orcaPage)
    await swallowBridgeReplies(orcaPage)
    await panelFrame(orcaPage).locator('#entry').fill('this one never reaches the host')
    await panelFrame(orcaPage).getByRole('button', { name: 'Add entry' }).click()
    await expect(panelFrame(orcaPage).locator('#status')).toHaveText('Saving…')
    await expect(panelFrame(orcaPage).locator('#status')).toContainText('The host did not answer', {
      timeout: 20_000
    })
    // The typed text survives a failed write; clearing it would have told the
    // user it was saved.
    await expect(panelFrame(orcaPage).locator('#entry')).toHaveValue(
      'this one never reaches the host'
    )
    await orcaPage.screenshot({
      path: testInfo.outputPath('control-b-timeout.png'),
      animations: 'disabled'
    })
  } finally {
    // The install itself needs no cleanup: the harness gives each run its own
    // userData, so it goes away with the profile.
    await rm(tempRoot, { recursive: true, force: true })
  }
})
