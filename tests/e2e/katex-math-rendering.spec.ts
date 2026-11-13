import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  cleanupMarkdownFixture,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-ordered-list-exit'
import { writeSettings } from './helpers/settings-write'

// Why: KaTeX lays out math only through its CSS; markup from another katex than the stylesheet's
// loses the classes 0.18 renamed, so struts stop sizing lines and \Large stops scaling (ORCA-994).
const MATH_MARKDOWN =
  '# Math\n\n' +
  'Inline $x^2 + \\sqrt{y}$ in prose.\n\n' +
  '$$\n\\sum_{i=1}^{n} \\frac{p}{q} = \\sqrt{a^2 + b^2} + {\\Large L} M\n$$\n'

const WIDTHS = [1440, 390] as const

type MathLayout = {
  numeratorBottom: number
  denominatorTop: number
  centerOffset: number
  inlineStruts: number
  largeToNormalRatio: number
}

async function readMathLayout(page: Page, rootSelector: string): Promise<MathLayout> {
  return page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector)
    const display = root?.querySelector('.katex-display')
    const leaves = Array.from(display?.querySelectorAll('span') ?? []).filter(
      (span) => span.childElementCount === 0
    )
    const leaf = (text: string) => leaves.find((span) => span.textContent === text)
    const [numerator, denominator, large, normal] = ['p', 'q', 'L', 'M'].map(leaf)
    if (!numerator || !denominator || !large || !normal) {
      throw new Error(`No rendered formula under ${rootSelector}`)
    }
    // Struts carry an inline height; an inline box ignores it.
    const struts = Array.from(display!.querySelectorAll<HTMLElement>('span[style*="height"]'))
    const fontSize = (span: Element) => Number.parseFloat(getComputedStyle(span).fontSize)
    const top = numerator.getBoundingClientRect()
    const bottom = denominator.getBoundingClientRect()
    return {
      numeratorBottom: top.bottom,
      denominatorTop: bottom.top,
      centerOffset: Math.abs(top.left + top.width / 2 - (bottom.left + bottom.width / 2)),
      inlineStruts: struts.filter((span) => getComputedStyle(span).display === 'inline').length,
      largeToNormalRatio: fontSize(large) / fontSize(normal)
    }
  }, rootSelector)
}

async function expectLaidOutMath(page: Page, rootSelector: string, label: string) {
  const layout = await readMathLayout(page, rootSelector)
  expect(layout.numeratorBottom, `${label}: numerator sits above denominator`).toBeLessThanOrEqual(
    layout.denominatorTop + 1
  )
  expect(layout.centerOffset, `${label}: numerator and denominator share a center`).toBeLessThan(4)
  expect(layout.inlineStruts, `${label}: every strut is a sized box`).toBe(0)
  expect(layout.largeToNormalRatio, `${label}: \\Large scales its group`).toBeGreaterThan(1.3)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
}

async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

async function activeFileId(page: Page): Promise<string> {
  return page.evaluate(() => window.__store!.getState().activeFileId!)
}

// Why: the Markdown preview is its own tab beside the rich editor's, not a view mode of it.
async function openPreviewTab(page: Page, filePath: string): Promise<string> {
  await page.evaluate((filePath) => {
    const state = window.__store!.getState()
    const source = state.openFiles.find((file) => file.id === state.activeFileId)!
    state.openMarkdownPreview({ ...source, filePath })
  }, filePath)
  await expect.poll(() => activeFileId(page)).toMatch(/^markdown-preview::/)
  return activeFileId(page)
}

test.describe('KaTeX math rendering', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('the same formula stacks in the Markdown preview and the rich editor', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    test.setTimeout(180_000)
    const context = await getActiveWorktreeContext(orcaPage)
    const filePath = await createMarkdownFixture(
      context,
      'katex',
      testInfo.workerIndex,
      MATH_MARKDOWN
    )
    try {
      await openMarkdownFixture(orcaPage, context, filePath)
      await waitForRichMarkdownEditor(orcaPage)
      const richFileId = await activeFileId(orcaPage)
      const previewFileId = await openPreviewTab(orcaPage, filePath)

      const surfaces = [
        { mode: 'preview', root: '.markdown-preview', fileId: previewFileId },
        { mode: 'rich', root: '.rich-markdown-editor', fileId: richFileId }
      ] as const
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(orcaPage, theme)
        for (const width of WIDTHS) {
          await setWindowWidth(electronApp, orcaPage, width)
          // Why: at 390 the two sidebars fill the window and the editor has no width left.
          await orcaPage.evaluate((open) => {
            window.__store!.getState().setSidebarOpen(open)
            window.__store!.getState().setRightSidebarOpen(open)
          }, width > 390)
          for (const surface of surfaces) {
            await orcaPage.evaluate(
              (id) => window.__store!.getState().setActiveFile(id),
              surface.fileId
            )
            const display = orcaPage.locator(`${surface.root} .katex-display`).first()
            await expect(display).toBeVisible({ timeout: 25_000 })
            await display.scrollIntoViewIfNeeded()
            await expectLaidOutMath(orcaPage, surface.root, `${surface.mode} ${width} ${theme}`)
            await orcaPage.screenshot({
              path: testInfo.outputPath(`math-${surface.mode}-${width}-${theme}.png`)
            })
          }
        }
      }
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })
})
