/**
 * Invariant: a plugin panel that declares no font renders in Orca's own UI font
 * and on the shell's base layer, and a panel that declares one keeps it.
 * Needs E2E: `@font-face` from a data URI under the panel CSP, inside an
 * opaque-origin sandboxed iframe, is exactly what Vitest cannot exercise —
 * only a real Chromium reports whether the face actually loaded.
 */

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const PANEL_TITLE = 'Hello Orca'

type PanelTypography = {
  fontFamily: string
  fontSize: string
  letterSpacing: string
  boxSizing: string
  geistLoaded: boolean
  /** `var(--radius-md)` resolved to px by the frame, proving the derived scale
   *  lands on the injected `--radius` instead of staying an unresolved calc. */
  resolvedRadiusMd: number
  headingWidth: number
}

async function materializePlugin(patchPanelCss: string | null): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'orca-panel-typography-e2e-'))
  const pluginRoot = join(tempRoot, 'hello-orca')
  await cp(join(process.cwd(), 'examples', 'plugins', 'hello-orca'), pluginRoot, {
    recursive: true
  })
  if (patchPanelCss) {
    const panelPath = join(pluginRoot, 'panel.html')
    const panelHtml = await readFile(panelPath, 'utf8')
    await writeFile(panelPath, panelHtml.replace('</style>', `${patchPanelCss}\n</style>`))
  }
  return pluginRoot
}

/** Drives the real setting so the whole window repaints, not just the root
 *  class — a screenshot of a half-applied theme is not evidence of one. */
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

async function installAndOpenPanel(page: Page, sourcePath: string): Promise<void> {
  await page.evaluate(async (pluginPath) => {
    const settings = await window.api.settings.set({ pluginSystemEnabled: true })
    window.__store?.setState({ settings })
    await window.api.plugins.refresh()
    const installed = await window.api.plugins.install({ kind: 'local-path', path: pluginPath })
    if (!installed.ok) {
      throw new Error(installed.error)
    }
    const listed = await window.api.plugins.refresh()
    const plugin = listed.find((entry) => entry.pluginKey === installed.pluginKey)
    if (!plugin?.consentFingerprint) {
      throw new Error(`installed plugin ${installed.pluginKey} has no reviewable panel`)
    }
    await window.api.plugins.consent({
      pluginKey: plugin.pluginKey,
      reviewedFingerprint: plugin.consentFingerprint,
      decision: 'approve'
    })
    const store = window.__store?.getState()
    if (!store) {
      throw new Error('window.__store is unavailable')
    }
    if (!store.rightSidebarOpen) {
      store.toggleRightSidebar()
    }
    await window.api.plugins.refresh()
  }, sourcePath)

  const panelButton = page.getByRole('button', { name: PANEL_TITLE })
  await expect(panelButton).toBeVisible({ timeout: 15_000 })
  await panelButton.click()
  await expect(page.locator(`iframe[title="${PANEL_TITLE}"]`)).toBeVisible({ timeout: 15_000 })
}

async function readPanelTypography(page: Page): Promise<PanelTypography> {
  const heading = page.frameLocator(`iframe[title="${PANEL_TITLE}"]`).locator('h1')
  await expect(heading).toBeVisible({ timeout: 15_000 })
  return heading.evaluate(async (node) => {
    const doc = node.ownerDocument
    const view = doc.defaultView
    if (!view) {
      throw new Error('panel frame has no window')
    }
    await doc.fonts.ready
    const style = view.getComputedStyle(doc.body)
    const probe = doc.createElement('div')
    probe.style.borderRadius = 'var(--radius-md)'
    doc.body.append(probe)
    const resolvedRadiusMd = Number.parseFloat(
      view.getComputedStyle(probe).borderTopLeftRadius || '0'
    )
    probe.remove()
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      letterSpacing: style.letterSpacing,
      boxSizing: style.boxSizing,
      // The only proof the woff2 data URI survived the panel CSP.
      geistLoaded: doc.fonts.check('14px Geist'),
      resolvedRadiusMd,
      headingWidth: Math.round(node.getBoundingClientRect().width)
    }
  })
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(value, null, 2)),
    contentType: 'application/json'
  })
}

function firstFamily(stack: string): string {
  return (stack.split(',')[0] ?? '').replaceAll(/['"]/g, '').trim()
}

test('renders a panel in the app font next to native UI', async ({ orcaPage }, testInfo) => {
  const pluginRoot = await materializePlugin(null)
  try {
    await installAndOpenPanel(orcaPage, pluginRoot)

    const hostFontFamily = await orcaPage.evaluate(() => getComputedStyle(document.body).fontFamily)
    const observed: Record<string, PanelTypography> = {}
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      observed[theme] = await readPanelTypography(orcaPage)
      await orcaPage.screenshot({ path: testInfo.outputPath(`panel-${theme}.png`) })
    }
    // A narrow window is where a panel's own paddings stop agreeing with the rail.
    await orcaPage.setViewportSize({ width: 900, height: 800 })
    await orcaPage.screenshot({ path: testInfo.outputPath('panel-narrow-900.png') })
    await attachJson(testInfo, 'panel-typography', { hostFontFamily, observed })

    for (const [theme, panel] of Object.entries(observed)) {
      expect(panel.geistLoaded, `${theme}: Geist face did not load`).toBe(true)
      expect(panel.fontFamily, `${theme}: panel font`).toContain('Geist')
      // Same first family as native chrome: the panel is not a foreign island.
      expect(firstFamily(panel.fontFamily)).toBe(firstFamily(hostFontFamily))
      expect(panel.boxSizing).toBe('border-box')
      expect(panel.letterSpacing).not.toBe('normal')
      expect(panel.resolvedRadiusMd).toBeGreaterThan(0)
      // A heading measured at a handful of pixels renders nothing worth judging.
      expect(panel.headingWidth).toBeGreaterThan(120)
    }
  } finally {
    await rm(join(pluginRoot, '..'), { recursive: true, force: true })
  }
})

test('keeps a panel-declared font-family over the shell base layer', async ({
  orcaPage
}, testInfo) => {
  const pluginRoot = await materializePlugin('body { font-family: "Courier New", monospace; }')
  try {
    await installAndOpenPanel(orcaPage, pluginRoot)
    const panel = await readPanelTypography(orcaPage)
    await attachJson(testInfo, 'opted-out-panel-typography', panel)
    await orcaPage.screenshot({ path: testInfo.outputPath('panel-own-font.png') })

    expect(panel.fontFamily).toContain('Courier New')
    expect(panel.fontFamily).not.toContain('Geist')
    // Opting out of the font keeps the rest of the base layer.
    expect(panel.boxSizing).toBe('border-box')
    expect(panel.resolvedRadiusMd).toBeGreaterThan(0)
  } finally {
    await rm(join(pluginRoot, '..'), { recursive: true, force: true })
  }
})
