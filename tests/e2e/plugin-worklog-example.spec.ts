/**
 * Invariant: the `worklog` example — the plugin the authoring guide tells people
 * to copy — installs, stays inert before consent, and once approved mounts its
 * settings-surface panel, which reads its data back over the panel bridge.
 * The write half is a known, measured gap; see the comment where it was removed.
 * Needs E2E: the panel is an opaque-origin sandboxed iframe whose only route to
 * the host is postMessage, so nothing below the real app exercises it.
 */

import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, FrameLocator, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const PANEL_TITLE = 'Worklog'
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

/** The panel has finished its own load when the mirror is painted and the
 *  status line is back to empty. Needs no click, which is the point. */
async function waitForPanelLoaded(page: Page): Promise<void> {
  await expect(panelFrame(page).locator('#settings')).toContainText('Author', { timeout: 20_000 })
  await expect(panelFrame(page).locator('#status')).toHaveText('', { timeout: 20_000 })
}

test('installs, consents, mounts and round-trips the worklog example plugin', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  // 16 captures across four widths and two themes.
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

    // ── Known gap: the write half of the bridge is not covered here ──────────
    // This spec used to type into #entry, click "Add entry" and assert the panel
    // reached 'Saved.'. It was removed after measuring, not after guessing.
    //
    // Under `electron-headless` a synthesized click never reaches the panel
    // document at all. Instrumenting the live document from CI showed, on the
    // failing run: the same document from start to finish (one stamp, one panel
    // frame, nothing UNSTAMPED), the button enabled, its rect identical before
    // and after the click — and across the whole 1913-line job log, zero
    // `mousedown`, zero `mouseup`, zero `elementFromPoint` entries. Playwright
    // reported the click as successful. The panel never saw a pointer event.
    //
    // Four causes were eliminated with evidence: a rebuilt frame (same stamp),
    // the click landing on a stale document (fill and click agree), the button
    // moving mid-gesture (rect unchanged, and no mousedown to move away from),
    // and the panel swallowing the event (its shell guards only <a href> clicks
    // and installs nothing for mousedown/mouseup). The same code passes locally
    // on this project, so it is the headless event route into a plugin panel
    // iframe, not the example. Tracked separately.
    //
    // What stays below still covers the real integration: install, the command
    // refused before consent, the consent dialog, the worker, the panel mounting
    // and `storage.get` answering over the bridge.
    await waitForPanelLoaded(orcaPage)

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
        await waitForPanelLoaded(orcaPage)
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
        await waitForPanelLoaded(orcaPage)
        await orcaPage.locator(`iframe[title="${PANEL_TITLE}"]`).screenshot({
          path: testInfo.outputPath(`worklog-frame-${achieved}-${theme}.png`),
          animations: 'disabled'
        })
      }
    }
  } finally {
    // The install itself needs no cleanup: the harness gives each run its own
    // userData, so it goes away with the profile.
    await rm(tempRoot, { recursive: true, force: true })
  }
})
