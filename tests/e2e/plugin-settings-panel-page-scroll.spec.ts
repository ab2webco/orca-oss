/**
 * Invariant: a `surface: 'settings'` panel grows to its own content height, so
 * the Settings page scrolls as one page and nothing is clipped — including
 * content the panel adds after load.
 * Needs E2E: the height is measured inside an opaque-origin sandboxed iframe
 * and only a real layout engine produces it; Vitest has no layout.
 */

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './helpers/orca-app'

const PANEL_TITLE = 'Registry'

/** Taller than any settings viewport, with a textarea last — the element the
 *  earlier fixed-height attempt cut in half — and a block that arrives after
 *  load, like the panel's own list refresh. */
const TALL_PANEL_HTML = `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; padding: 0 0 24px; color: var(--foreground); background: var(--background); }
      section { padding: 12px 16px; border-bottom: 1px solid var(--border); }
      textarea { width: 100%; height: 120px; }
    </style>
  </head>
  <body>
    <div id="rows"></div>
    <section id="tail">
      <p>Last block</p>
      <textarea id="note">bottom textarea</textarea>
    </section>
    <script>
      'use strict'
      function addRows(count, prefix) {
        var rows = document.getElementById('rows')
        for (var i = 0; i < count; i++) {
          var row = document.createElement('section')
          row.textContent = prefix + ' row ' + (i + 1)
          rows.appendChild(row)
        }
      }
      addRows(24, 'initial')
      // The conversation list repopulating long after first paint.
      setTimeout(function () {
        addRows(12, 'late')
      }, 1200)
    </script>
  </body>
</html>
`

test('grows a settings-surface plugin panel to its content height', async ({
  orcaPage
}, testInfo) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-panel-page-scroll-e2e-'))
  const pluginRoot = join(tempRoot, 'hello-orca')
  await cp(join(process.cwd(), 'examples', 'plugins', 'hello-orca'), pluginRoot, {
    recursive: true
  })
  await writeFile(join(pluginRoot, 'tall-panel.html'), TALL_PANEL_HTML)
  const manifestPath = join(pluginRoot, 'orca-plugin.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.contributes.panels = [
    {
      id: 'registry',
      title: PANEL_TITLE,
      icon: 'file-text',
      entry: 'tall-panel.html',
      surface: 'settings'
    }
  ]
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

  try {
    const installed = await orcaPage.evaluate(async (sourcePath) => {
      const settings = await window.api.settings.set({ pluginSystemEnabled: true })
      window.__store?.setState({ settings })
      const result = await window.api.plugins.install({ kind: 'local-path', path: sourcePath })
      if (!result.ok) {
        throw new Error(result.error)
      }
      await window.api.plugins.refresh()
      return { pluginKey: result.pluginKey }
    }, pluginRoot)

    await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('store unavailable')
      }
      state.openSettingsTarget({ pane: 'plugins', repoId: null })
      state.openSettingsPage()
    })
    await orcaPage.getByRole('tab', { name: /^Installed/ }).click()
    const row = orcaPage.locator(`[data-plugin-key="${installed.pluginKey}"]`)
    await row.getByRole('button', { name: 'Review & enable' }).click()
    const consent = orcaPage.getByRole('dialog', { name: 'Review permissions' })
    await consent.getByRole('button', { name: 'Enable plugin' }).click()
    await expect(consent).toBeHidden()

    const panelRow = orcaPage.getByRole('button', { name: PANEL_TITLE, exact: true })
    await expect(panelRow).toBeVisible({ timeout: 15_000 })
    await panelRow.click()

    const frame = orcaPage.locator(`iframe[title="${PANEL_TITLE}"]`)
    await expect(frame).toBeVisible({ timeout: 15_000 })

    // The frame stops growing once it matches the document inside it.
    const fits = async (): Promise<boolean> =>
      orcaPage
        .frameLocator(`iframe[title="${PANEL_TITLE}"]`)
        .locator('#tail')
        .evaluate((node) => {
          const view = node.ownerDocument.defaultView
          if (!view) {
            return false
          }
          const root = node.ownerDocument.documentElement
          return (
            root.scrollHeight <= root.clientHeight + 1 &&
            node.getBoundingClientRect().bottom <= view.innerHeight + 1
          )
        })
    // The late rows land 1.2s in; poll past them so the settled height is the grown one.
    await expect.poll(fits, { timeout: 15_000 }).toBe(true)
    await expect(
      orcaPage.frameLocator(`iframe[title="${PANEL_TITLE}"]`).locator('#rows section')
    ).toHaveCount(36)

    // The one scroller that must exist: the settings page itself. Scoped to the
    // section's own ancestors — the settings sidebar is a scroller too, and it
    // is the first one a document-wide query returns.
    const sectionSelector = `[data-settings-section="plugin:${installed.pluginKey}/registry"]`
    const scrollState = await orcaPage.evaluate((selector) => {
      const section = document.querySelector<HTMLElement>(selector)
      if (!section) {
        return null
      }
      const isScrollable = (element: HTMLElement): boolean =>
        element.scrollHeight > element.clientHeight + 8 &&
        !['visible', 'hidden'].includes(getComputedStyle(element).overflowY)
      const nested = Array.from(section.querySelectorAll<HTMLElement>('*')).filter(isScrollable)
      let pageScroller: HTMLElement | null = null
      for (
        let node = section.parentElement;
        node && node !== document.body;
        node = node.parentElement
      ) {
        if (isScrollable(node)) {
          pageScroller = node
          break
        }
      }
      if (!pageScroller) {
        return { nestedCount: nested.length, pageScroller: null }
      }
      pageScroller.scrollTop = pageScroller.scrollHeight
      return {
        nestedCount: nested.length,
        nestedClassNames: nested.map((element) => element.className),
        pageScroller: {
          className: pageScroller.className,
          scrolledBy: pageScroller.scrollTop,
          overflow: pageScroller.scrollHeight - pageScroller.clientHeight
        }
      }
    }, sectionSelector)
    expect(scrollState, 'the plugin settings section did not render').not.toBeNull()
    expect(
      scrollState!.pageScroller,
      'the settings page did not overflow — the screenshot proves nothing'
    ).not.toBeNull()
    expect(scrollState!.pageScroller!.scrolledBy).toBeGreaterThan(0)
    // Zero scrollers inside the section: a scroller in a scroller is the defect.
    expect(scrollState!.nestedCount, JSON.stringify(scrollState!.nestedClassNames)).toBe(0)

    await orcaPage.screenshot({ path: testInfo.outputPath('settings-panel-bottom.png') })

    // Nothing clipped: the panel's last element is on screen after that scroll.
    // Measured across the boundary — the host cannot read into the opaque frame,
    // so the frame reports the offset and the page places the frame.
    const noteBottomInFrame = await orcaPage
      .frameLocator(`iframe[title="${PANEL_TITLE}"]`)
      .locator('#note')
      .evaluate((node) => node.getBoundingClientRect().bottom)
    const frameBox = await frame.boundingBox()
    const viewportHeight = await orcaPage.evaluate(() => window.innerHeight)
    expect(frameBox).not.toBeNull()
    expect(frameBox!.y + noteBottomInFrame).toBeLessThanOrEqual(viewportHeight + 1)

    await orcaPage.evaluate((selector) => {
      const section = document.querySelector<HTMLElement>(selector)
      for (
        let node = section?.parentElement ?? null;
        node && node !== document.body;
        node = node.parentElement
      ) {
        if (node.scrollHeight > node.clientHeight + 8) {
          node.scrollTop = 0
          return
        }
      }
    }, sectionSelector)
    await orcaPage.screenshot({ path: testInfo.outputPath('settings-panel-top.png') })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
