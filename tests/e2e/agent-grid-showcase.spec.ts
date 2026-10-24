import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  splitActiveTerminalPane,
  waitForPaneCount,
  waitForPaneIdentitySnapshot
} from './helpers/terminal'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'

// Records the agent grid for the README showcase. Each frame is a real state
// the grid must render, so the GIF cannot drift from what the app does.

const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 800
const HOLD_MS = 900

const WAITING_AGENT = 'Review agent'
const WORKING_AGENT = 'Build agent'
const DONE_AGENT = 'Ship agent'
const FOURTH_AGENT = 'Test agent'
const BOARD_TOAST = 'Workspace board moved to the bottom bar'

async function resizeWindow(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('No Electron window')
      }
      window.setSize(size.width, size.height)
    },
    { width: WINDOW_WIDTH, height: WINDOW_HEIGHT }
  )
}

async function seedAgentStatus(
  page: Page,
  paneKey: string,
  state: 'blocked' | 'working' | 'done',
  title: string
): Promise<void> {
  await page.evaluate(
    ({ paneKey, state, title }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const now = Date.now()
      store
        .getState()
        .setAgentStatus(
          paneKey,
          { state, prompt: title, agentType: 'codex', lastAssistantMessage: title },
          title,
          { updatedAt: now, stateStartedAt: now - 1_000 }
        )
    },
    { paneKey, state, title }
  )
}

async function openAgentGrid(page: Page): Promise<void> {
  // The in-window drawer host sits behind an experimental setting.
  await page.evaluate(async () => {
    const settings = await window.api.settings.set({ experimentalAgentDashboardPopout: true })
    window.__store?.setState({ settings })
    window.__store?.getState().setSidebarOpen?.(true)
  })
  await page.evaluate(() => {
    window.__store?.getState().setAgentDashboardDrawerOpen(true)
  })
}

function gridCells(page: Page) {
  return page.locator('[data-agent-grid-cell]')
}

function bucketButton(page: Page, label: RegExp) {
  return page
    .locator('[data-agent-grid-controls] [aria-pressed]')
    .filter({ hasText: label })
    .first()
}

test('agent grid groups live agents into buckets and filters them', async ({
  orcaPage: page,
  electronApp,
  testRepoPath
}, testInfo) => {
  test.setTimeout(180_000)
  await waitForSessionReady(page)
  await resizeWindow(electronApp)

  await attachRepoAndOpenTerminal(page, testRepoPath)
  await ensureTerminalVisible(page)
  await splitActiveTerminalPane(page, 'vertical')
  await splitActiveTerminalPane(page, 'horizontal')
  await splitActiveTerminalPane(page, 'vertical')
  await waitForPaneCount(page, 4)
  const snapshot = await waitForPaneIdentitySnapshot(page, 4)

  const paneKeys = snapshot.panes.map((pane) => `${snapshot.tabId}:${pane.leafId}`)
  expect(paneKeys.length, 'four panes give one agent per bucket').toBe(4)

  await seedAgentStatus(page, paneKeys[0], 'blocked', WAITING_AGENT)
  await seedAgentStatus(page, paneKeys[1], 'working', WORKING_AGENT)
  await seedAgentStatus(page, paneKeys[2], 'done', DONE_AGENT)
  await seedAgentStatus(page, paneKeys[3], 'working', FOURTH_AGENT)

  await openAgentGrid(page)
  await expect.poll(() => gridCells(page).count(), { timeout: 30_000 }).toBe(4)
  await expect(page.getByText(BOARD_TOAST)).toHaveCount(0, { timeout: 15_000 })

  const frame = async (name: string): Promise<void> => {
    await page.waitForTimeout(HOLD_MS)
    await page.screenshot({ path: testInfo.outputPath(name) })
  }

  await frame('01-all.png')

  await bucketButton(page, /Working/).click()
  await expect.poll(() => gridCells(page).count()).toBe(2)
  await frame('02-working.png')

  await bucketButton(page, /Done/).click()
  await expect.poll(() => gridCells(page).count()).toBe(1)
  await frame('03-done.png')

  // The filter is single-select, so the active bucket clears when pressed again.
  await bucketButton(page, /Done/).click()
  await expect.poll(() => gridCells(page).count()).toBe(4)
  await frame('04-all-again.png')
})
