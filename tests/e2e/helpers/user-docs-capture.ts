import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ElectronApplication, Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import { createShowcaseRepo } from './showcase-repo'
import { writeSettings } from './settings-write'

// Window, theme and capture helpers for the zero-to-expert docs captures (ORCA-1178).
export const WINDOW = { width: 1280, height: 800 }
export const DOCS_REPO = '/Users/Shared/orca-docs/lumen-app'

export async function setWindowSize(
  app: ElectronApplication,
  page: Page,
  size: { width: number; height: number } = WINDOW
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, target) => {
    BrowserWindow.getAllWindows()[0]?.setSize(target.width, target.height)
  }, size)
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(size.width)
}

export async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(() =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

type Region = Locator | (() => Promise<{ x: number; y: number; width: number; height: number }>)

/** The Lumen repo; at DOCS_REPO when capturing for the docs, else in a temp folder. */
export function docsRepo(): string {
  const repo = createShowcaseRepo()
  if (process.env.ORCA_DOCS_CAPTURE !== '1' || process.platform !== 'darwin') {
    return repo
  }
  rmSync(dirname(DOCS_REPO), { recursive: true, force: true })
  mkdirSync(dirname(DOCS_REPO), { recursive: true })
  renameSync(repo, DOCS_REPO)
  return DOCS_REPO
}

/** Saves `<name>.png` and `<name>.dark.png`, the names the docs transform pairs by theme. */
export async function captureBothThemes(
  page: Page,
  testInfo: TestInfo,
  name: string,
  region: Region
): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    // Why: theme tokens repaint over a transition; a capture mid-way mixes both themes.
    await page.waitForTimeout(400)
    const path = testInfo.outputPath(`${name}${theme === 'dark' ? '.dark' : ''}.png`)
    await (typeof region === 'function'
      ? page.screenshot({ path, clip: await region() })
      : region.screenshot({ path }))
  }
}

/** The box around `target` from the window's left edge, so a sidebar shows its header too. */
export function fromLeftEdge(target: Locator, pad = 6, right = -2) {
  return async () => {
    const box = await target.boundingBox()
    if (!box) {
      throw new Error('capture target is not on screen')
    }
    // Why `right` stops short of the row: past it the panel's border and the title bar show.
    return { x: 0, y: 0, width: box.x + box.width + right, height: box.y + box.height + pad }
  }
}
