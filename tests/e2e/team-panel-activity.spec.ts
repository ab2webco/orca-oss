import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  splitActiveTerminalPane,
  waitForActiveTerminalManager,
  waitForPaneCount,
  waitForPaneIdentitySnapshot
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

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

async function setLanguage(page: Page, uiLanguage: 'en' | 'es'): Promise<void> {
  await page.evaluate(
    (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
    uiLanguage
  )
}

const COPY = {
  en: { title: 'Your work', activity: 'Activity', others: 'Other sessions', asked: 'Asked' },
  es: { title: 'Tu trabajo', activity: 'Actividad', others: 'Otras sesiones', asked: 'Pedido' }
} as const

const QUESTION = 'Apply the migration now or at release?'

async function seedAgents(page: Page, panes: [string, string]): Promise<void> {
  await page.evaluate(
    ({ panes, question }) => {
      const store = window.__store!
      const now = Date.now()
      store.getState().setAgentStatus(
        panes[0],
        {
          state: 'working',
          prompt: 'Check how the merge queue is doing',
          agentType: 'claude',
          model: 'claude-opus-5-5',
          toolName: 'Bash',
          toolInput: 'gh pr checks 912'
        },
        'Claude main',
        { updatedAt: now - 60_000, stateStartedAt: now - 60_000 }
      )
      store.getState().setAgentStatus(
        panes[1],
        {
          state: 'blocked',
          prompt: 'Fix the checks panel tooltip',
          agentType: 'claude',
          model: 'claude-sonnet-5-5',
          toolName: 'AskUserQuestion',
          interactivePrompt: JSON.stringify({
            questions: [
              {
                question,
                multiSelect: false,
                options: [{ label: 'Now' }, { label: 'At release' }]
              }
            ]
          })
        },
        'Claude tooltip',
        { updatedAt: now - 120_000, stateStartedAt: now - 120_000 }
      )
    },
    { panes, question: QUESTION }
  )
}

// ORCA-1074: with no game team the panel is "Your work", opened on Activity, built from agent status.
test('the no-team panel shows Activity for the selected agent and live sidebar rows', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  const hasPaneManager = await waitForActiveTerminalManager(orcaPage, 30_000)
    .then(() => true)
    .catch(() => false)
  test.skip(!hasPaneManager, 'This Electron run never mounts the live TerminalPane manager.')
  await waitForPaneCount(orcaPage, 1, 30_000)
  await splitActiveTerminalPane(orcaPage, 'vertical')
  await waitForPaneCount(orcaPage, 2)
  const snapshot = await waitForPaneIdentitySnapshot(orcaPage, 2)
  const panes = snapshot.panes.map((pane) => `${snapshot.tabId}:${pane.leafId}`)
  await seedAgents(orcaPage, [panes[0]!, panes[1]!])

  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    if (!state.worktreeCardProperties.includes('inline-agents')) {
      state.setWorktreeCardProperties([...state.worktreeCardProperties, 'inline-agents'])
    }
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })

  const panel = orcaPage.getByTestId('team-panel')
  const summary = orcaPage.locator('.compact-agent-summary-button[aria-expanded="false"]').first()
  if (await summary.isVisible()) {
    await summary.click()
  }
  // Why: the blocked agent's question replaces its prompt in the left sidebar row.
  await expect(orcaPage.locator('.compact-agent-row').getByText(QUESTION)).toBeVisible()
  await expect(
    orcaPage.locator('.compact-agent-row').getByText('Bash · gh pr checks 912')
  ).toBeVisible()

  for (const language of ['en', 'es'] as const) {
    await setLanguage(orcaPage, language)
    const copy = COPY[language]
    await expect(panel.getByRole('heading', { name: copy.title })).toBeVisible()
    await expect(panel.getByRole('tab', { name: copy.activity })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(panel.locator('[data-team-activity="selected"]')).toContainText(copy.asked)
    await expect(panel.getByText(copy.others)).toBeVisible()
    await expect(panel.locator('[data-team-activity="other"]')).toHaveCount(1)

    for (const width of [1440, 768, 390, 320]) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`team-activity-${language}-${width}-${theme}.png`)
        })
      }
    }
  }
  await setLanguage(orcaPage, 'en')
  await orcaPage.setViewportSize({ width: 1440, height: 900 })

  // Why no switch check here: the panel focuses a pane through activateTabAndFocusPane, which waits
  // one animation frame, and the never-shown E2E window produces frames at ~1 Hz or not at all
  // (helpers/frame-independent-ui.ts). team-panel-activity-tab.test.tsx covers the press.

  // The hover card holds what left the row; it stays off while Activity shows the same facts.
  await orcaPage.evaluate(() =>
    window.__store!.getState().updateSettings({ experimentalNewWorktreeCardStyle: true })
  )
  const card = orcaPage.locator('[data-worktree-card-hover-trigger]').first()
  const agentFacts = orcaPage.locator('[data-worktree-agent-hover]')
  await card.hover()
  await orcaPage.waitForTimeout(600)
  await expect(agentFacts).toHaveCount(0)
  await orcaPage.mouse.move(700, 600)
  await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarOpen(false))
  await card.hover()
  await expect(agentFacts).toBeVisible()
  await expect(agentFacts).toContainText('Opus 5.5')
  await expect(agentFacts).toContainText('Sonnet 5.5')
  await orcaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('team-activity-hover-card.png')
  })
})
