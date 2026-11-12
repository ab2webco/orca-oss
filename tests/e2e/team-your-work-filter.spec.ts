/**
 * ORCA-1148: in 'Your work', each count filters the session list to its own sessions, and a
 * dispatched member's request reads as its task, never as the raw brief.
 */
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'

const WIDTHS = [1440, 768, 390, 320]
const BRIEF = [
  '<pasted_content id="e1f9">',
  'You are working inside Orca Lab, a multi-agent IDE. You are a dispatched worker.',
  "Your coordinator's terminal handle is: term_e2e",
  'Your task ID is: task_e2e',
  '',
  '=== TASK ===',
  'Answer the WAINBOX-121 inbox thread'
].join('\n')

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(() =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

test('Your work counts filter the list, and a dispatched request reads as its task', async ({
  orcaPage
}, testInfo) => {
  test.setTimeout(240_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await writeSettings(orcaPage, { uiLanguage: 'en' })
  await orcaPage.evaluate(
    ({ worktreeId: id, brief }) => {
      const store = window.__store!
      const tab = store.getState().tabsByWorktree[id]![0]!
      const seed = (n: number, state: 'working' | 'done' | 'blocked', prompt: string) =>
        store
          .getState()
          .setAgentStatus(
            `${tab.id}:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
            { state, prompt, agentType: 'claude' },
            'Claude',
            { updatedAt: Date.now(), stateStartedAt: Date.now() },
            { tabId: tab.id, terminalHandle: `your-work-${n}`, worktreeId: id }
          )
      seed(1, 'blocked', brief)
      seed(2, 'working', 'Fix the checks tooltip')
      seed(3, 'working', 'Rename the sidebar groups')
      seed(4, 'done', 'Ship the release notes')
      store.getState().setRightSidebarOpen(true)
      store.getState().setRightSidebarTab('team')
    },
    { worktreeId, brief: BRIEF }
  )
  const panel = orcaPage.getByTestId('team-panel')
  const rows = panel.locator('[data-team-activity][data-pane-key]')
  await expect(rows).toHaveCount(4, { timeout: 30_000 })

  // The waiting member opens first: its request is the task, not the brief.
  const selected = panel.locator('[data-team-activity="selected"]')
  await expect(selected).toContainText('Answer the WAINBOX-121 inbox thread')
  await expect(selected).not.toContainText('pasted_content')
  await expect(selected).not.toContainText('You are working inside')

  const working = panel.locator('[data-team-activity-filter="working"]')
  for (const width of WIDTHS) {
    await orcaPage.setViewportSize({ width, height: 900 })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      await expect(working).toHaveAttribute('aria-pressed', 'false')
      await orcaPage.screenshot({
        path: testInfo.outputPath(`your-work-all-${width}-${theme}.png`)
      })
      await working.click()
      await expect(working).toHaveAttribute('aria-pressed', 'true')
      await expect(rows).toHaveCount(2)
      await expect(panel.locator('[data-team-activity-count]')).toContainText('2 working')
      await orcaPage.screenshot({
        path: testInfo.outputPath(`your-work-working-${width}-${theme}.png`)
      })
      await working.press('Escape')
      await expect(rows).toHaveCount(4)
    }
  }
})
