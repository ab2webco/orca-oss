import type { Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { clickWithoutFrameDependency } from './helpers/frame-independent-ui'
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
  en: {
    title: 'Your work',
    activity: 'Activity',
    others: 'Other sessions',
    prompt: 'Prompt',
    count: '1 need'
  },
  es: {
    title: 'Tu trabajo',
    activity: 'Actividad',
    others: 'Otras sesiones',
    prompt: 'Pedido',
    count: '1 te necesita'
  }
} as const

const EMPTY = { en: 'No agents running', es: 'No hay agentes en marcha' } as const

const QUESTION = 'Apply the migration now or at release?'

/** Every language, width and theme, after checking the screen means what the name says. */
async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
  check: (language: 'en' | 'es') => Promise<void>
): Promise<void> {
  for (const language of ['en', 'es'] as const) {
    await setLanguage(page, language)
    await check(language)
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(page, theme)
        await page.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`team-activity-${name}-${language}-${width}-${theme}.png`)
        })
      }
    }
  }
  await setLanguage(page, 'en')
  await page.setViewportSize({ width: 1440, height: 900 })
}

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
          effort: 'high',
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

  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    if (!state.worktreeCardProperties.includes('inline-agents')) {
      state.setWorktreeCardProperties([...state.worktreeCardProperties, 'inline-agents'])
    }
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })

  const panel = orcaPage.getByTestId('team-panel')
  await capture(orcaPage, testInfo, 'empty', async (language) => {
    await expect(panel.getByRole('heading', { name: COPY[language].title })).toBeVisible()
    await expect(panel.getByRole('tabpanel')).toContainText(EMPTY[language])
  })

  await seedAgents(orcaPage, [panes[0]!, panes[1]!])
  const summary = orcaPage.locator('.compact-agent-summary-button[aria-expanded="false"]').first()
  if (await summary.isVisible()) {
    await summary.click()
  }
  // Why: the blocked agent's question replaces its prompt in the left sidebar row.
  await expect(orcaPage.locator('.compact-agent-row').getByText(QUESTION)).toBeVisible()
  await expect(
    orcaPage.locator('.compact-agent-row').getByText('Bash · gh pr checks 912')
  ).toBeVisible()

  await capture(orcaPage, testInfo, 'full', async (language) => {
    const copy = COPY[language]
    await expect(panel.getByRole('heading', { name: copy.title })).toBeVisible()
    await expect(panel.getByRole('tab', { name: copy.activity })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(panel.locator('[data-team-activity="selected"]')).toContainText(copy.prompt)
    await expect(panel.locator('[data-team-activity-count]')).toContainText(copy.count)
    await expect(panel.getByText(copy.others)).toBeVisible()
    await expect(panel.locator('[data-team-activity="other"]')).toHaveCount(1)
  })

  // Pressing the other session focuses its pane, and Activity follows that focus.
  const selected = panel.locator('[data-team-activity="selected"]')
  const before = await selected.getAttribute('data-pane-key')
  const other = panel.locator('[data-team-activity="other"]')
  const target = await other.getAttribute('data-pane-key')
  expect(target).not.toBe(before)
  // Why: activateTabAndFocusPane waits one frame and a never-shown window has none; only that frame
  // is substituted, so the click, the focus event, the pane and the panel below are all real.
  await orcaPage.evaluate(() => {
    window.requestAnimationFrame = (callback) =>
      window.setTimeout(() => callback(performance.now()), 16)
    window.cancelAnimationFrame = (id) => window.clearTimeout(id)
  })
  // A press on the pane the manager already holds fires no change, so the store must agree first.
  await expect
    .poll(() =>
      orcaPage.evaluate(() => {
        const state = window.__store!.getState()
        const tabId = state.activeTabId!
        const stored = state.terminalLayoutsByTabId[tabId]?.activeLeafId
        return stored === window.__paneManagers?.get(tabId)?.getActivePane()?.leafId
      })
    )
    .toBe(true)
  await clickWithoutFrameDependency(other, orcaPage)
  await expect(selected).toHaveAttribute('data-pane-key', target!)
  await expect(other).toHaveAttribute('data-pane-key', before!)
  await orcaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('team-activity-after-switch.png')
  })

  // The default card has no badge here, so its title is the way to the hover card.
  const title = orcaPage.locator('[data-worktree-title-inline-rename]').first()
  const defaultFacts = orcaPage.locator('[data-worktree-agent-hover]')
  await title.hover()
  await orcaPage.waitForTimeout(600)
  await expect(defaultFacts).toHaveCount(0)
  await orcaPage.mouse.move(700, 600)
  await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarOpen(false))
  await title.hover()
  await expect(defaultFacts).toBeVisible()
  await expect(defaultFacts).toContainText('Opus 5.5 · high')
  await orcaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('team-activity-hover-default-card.png')
  })
  await orcaPage.mouse.move(700, 600)
  await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarOpen(true))

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
