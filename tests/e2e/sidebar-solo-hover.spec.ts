import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  waitForActiveTerminalManager,
  waitForPaneCount,
  waitForPaneIdentitySnapshot
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { worktreeRow } from './worktree-row-locators'

const WIDTHS = [1440, 768, 390, 320]

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

// Why: beside a row on a phone-width window a card can run past the right edge, cut in half.
async function expectInsideWindow(page: Page, card: Locator, where: string): Promise<void> {
  const width = page.viewportSize()!.width
  await expect
    .poll(
      async () => {
        const box = await card.boundingBox()
        return box !== null && box.x >= 0 && box.x + box.width <= width
      },
      { message: `the solo card leaves the window at ${where}` }
    )
    .toBe(true)
}

// ORCA-1149 S7: a one-agent worktree's card leads with V30's agent facts and keeps the classic card.
test("a solo row's card shows V30's agent facts above the worktree's own details", async ({
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage, 30_000)
  await waitForPaneCount(orcaPage, 1, 30_000)
  const single = await waitForPaneIdentitySnapshot(orcaPage, 1)
  const paneKey = `${single.tabId}:${single.panes[0]!.leafId}`
  await writeSettings(orcaPage, { uiLanguage: 'en' })
  await orcaPage.evaluate((paneKey) => {
    const state = window.__store!.getState()
    if (!state.worktreeCardProperties.includes('inline-agents')) {
      state.setWorktreeCardProperties([...state.worktreeCardProperties, 'inline-agents'])
    }
    // Why closed: Activity shows the same facts, so the card stays off while it is open.
    state.setRightSidebarOpen(false)
    state.setAgentStatus(
      paneKey,
      {
        state: 'working',
        prompt: 'Fix the checks panel tooltip',
        agentType: 'claude',
        model: 'claude-opus-5-5',
        effort: 'high',
        toolName: 'Bash',
        toolInput: 'gh pr checks 912'
      },
      'Claude'
    )
  }, paneKey)

  const row = worktreeRow(orcaPage, worktreeId).locator('[data-sidebar-solo-row]')
  await expect(row).toBeVisible()
  const cards = orcaPage.locator('[data-slot="hover-card-content"]')
  const facts = cards.locator('[data-sidebar-solo-hover]')

  for (const width of WIDTHS) {
    await orcaPage.setViewportSize({ width, height: 900 })
    for (const theme of ['dark', 'light'] as const) {
      const where = `${width}px ${theme}`
      await setTheme(orcaPage, theme)
      await orcaPage.mouse.move(0, 0)
      await expect(cards).toHaveCount(0)
      await row.locator('[data-team-row-part="name"]').hover()
      await expect(facts, `solo facts at ${where}`).toBeVisible()
      await expect(facts.locator('dt')).toContainText(['State', 'Prompt', 'Now', 'Model'])
      await expect(facts).toContainText('Working')
      await expect(facts).toContainText('Fix the checks panel tooltip')
      await expect(facts).toContainText('Bash · gh pr checks 912')
      await expect(facts).toContainText('Opus 5.5 · high')
      // The worktree's own details card is still there, below the facts.
      await expect(cards.locator('[data-worktree-hover-identity-header]')).toBeVisible()
      await expectInsideWindow(orcaPage, cards, where)
      const file = `sidebar-solo-hover-${width}-${theme}.png`
      const shot = await orcaPage.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(file)
      })
      // Why attached: CI keeps test-results only on failure; the JSON report carries captures on green runs too.
      await testInfo.attach(file, { body: shot, contentType: 'image/png' })
    }
  }
  await orcaPage.mouse.move(0, 0)
  await expect(cards, 'the card stayed open after the pointer left').toHaveCount(0)
})
