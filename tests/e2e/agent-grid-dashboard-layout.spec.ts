import { execSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { resolveAgentGridMinCellHeight } from '../../src/renderer/src/components/dashboard-popout/agent-grid-columns'
import {
  execInTerminal,
  splitActiveTerminalPane,
  waitForPaneCount,
  waitForPaneIdentitySnapshot
} from './helpers/terminal'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'

// The grid shipped with zero E2E coverage and all three of its real defects were
// integration, not cell logic (ORCA-281). Everything here is measured off the DOM
// the app actually lays out: a renderer test with fixed props reproduces none of them.

/** One page-size choice with rowsOnScreen === 1, so a cell's height is the whole
 *  measured budget and the two window heights cannot be confused with the floor. */
const SINGLE_ROW_PAGE_SIZE = 1
const SHORT_WINDOW_HEIGHT = 800
const TALL_WINDOW_HEIGHT = 1100
const WINDOW_WIDTH = 1500

const WAITING_AGENT = 'Grid waiting agent'
const WORKING_AGENT = 'Grid working agent'
const DONE_AGENT = 'Grid done agent'
const SECOND_PROJECT_AGENT = 'Second project agent'
const TAIL_MARKER = 'ORCA_TAIL_COLOUR'

type SeededPane = { paneKey: string; leafId: string; ptyId: string }

function createSecondSeededRepo(): string {
  const repoDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-grid-repo-')))
  execSync('git init', { cwd: repoDir, stdio: 'pipe' })
  execSync('git config user.email "e2e@test.local"', { cwd: repoDir, stdio: 'pipe' })
  execSync('git config user.name "E2E Test"', { cwd: repoDir, stdio: 'pipe' })
  writeFileSync(path.join(repoDir, 'README.md'), '# Second project\n')
  execSync('git add -A', { cwd: repoDir, stdio: 'pipe' })
  execSync('git commit -m "Second project for the agent grid"', { cwd: repoDir, stdio: 'pipe' })
  return repoDir
}

async function resizeWindow(
  electronApp: ElectronApplication,
  width: number,
  height: number
): Promise<void> {
  await electronApp.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('No Electron window')
      }
      window.setSize(size.width, size.height)
    },
    { width, height }
  )
}

async function seedAgentStatus(
  page: Page,
  paneKey: string,
  state: 'blocked' | 'working' | 'done',
  title: string,
  routing?: { tabId: string; worktreeId: string }
): Promise<void> {
  await page.evaluate(
    ({ paneKey, state, title, routing }) => {
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
          { updatedAt: now, stateStartedAt: now - 1_000 },
          routing
        )
    },
    { paneKey, state, title, routing }
  )
}

async function openAgentGrid(page: Page): Promise<void> {
  // The in-window drawer host is behind an experimental setting; E2E profiles
  // ship production defaults, so it renders nothing until this is on.
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

function cell(page: Page, paneKey: string) {
  return page.locator(`[data-agent-grid-cell="${paneKey}"]`)
}

/** Height the browser actually laid the cell out at — not the inline track
 *  string, which a fixed-height grid would still print. */
async function measureFirstCellHeight(page: Page): Promise<number> {
  const box = await gridCells(page).first().boundingBox()
  if (!box) {
    throw new Error('Grid cell has no layout box')
  }
  return box.height
}

/** Waits for the ResizeObserver-driven remeasure to land. `differentFrom` is the
 *  height before a resize; polling for "not that" beats a fixed sleep. */
async function settledCellHeight(page: Page, differentFrom?: number): Promise<number> {
  let height = 0
  await expect
    .poll(
      async () => {
        height = await measureFirstCellHeight(page)
        return differentFrom === undefined ? height > 0 : Math.abs(height - differentFrom) > 1
      },
      { timeout: 15_000, message: 'Grid never settled on a measured cell height' }
    )
    .toBe(true)
  return height
}

/** The strip's own numbers, read off the buttons the user sees. */
async function readBucketCounts(
  page: Page
): Promise<{ attention: number; working: number; done: number; idle: number }> {
  const read = async (label: RegExp): Promise<number> => {
    const text = (await page.getByRole('button', { name: label }).first().innerText()).trim()
    return Number(text.split(/\s+/).at(-1) ?? '0')
  }
  return {
    attention: await read(/^Waiting/),
    working: await read(/^Working/),
    done: await read(/^Done/),
    idle: await read(/^Idle/)
  }
}

test('agent grid fills its height, filters by bucket, collapses a project and paints the tail', async ({
  orcaPage: page,
  electronApp,
  testRepoPath
}) => {
  test.setTimeout(240_000)
  await waitForSessionReady(page)
  await resizeWindow(electronApp, WINDOW_WIDTH, SHORT_WINDOW_HEIGHT)

  // The second project first: attaching a repo opens its terminal and takes the
  // active tab, and the pane snapshot below reads whichever tab is active.
  const secondRepoPath = createSecondSeededRepo()
  await attachRepoAndOpenTerminal(page, secondRepoPath)
  await ensureTerminalVisible(page)
  const secondSnapshot = await waitForPaneIdentitySnapshot(page, 1)
  const secondRepoId = await page.evaluate(async (repoPath) => {
    const repos = window.__store?.getState().repos ?? []
    const match = repos.find((repo) => repo.path === repoPath)
    return match?.id ?? ''
  }, secondRepoPath)
  expect(secondRepoId, 'the second project must be a repo of its own').not.toBe('')

  const worktreeId = await attachRepoAndOpenTerminal(page, testRepoPath)
  await ensureTerminalVisible(page)
  await splitActiveTerminalPane(page, 'vertical')
  await splitActiveTerminalPane(page, 'horizontal')
  await waitForPaneCount(page, 3)
  const snapshot = await waitForPaneIdentitySnapshot(page, 3)

  const panes: SeededPane[] = snapshot.panes
    .filter((pane): pane is typeof pane & { ptyId: string } => Boolean(pane.ptyId))
    .map((pane) => ({
      paneKey: `${snapshot.tabId}:${pane.leafId}`,
      leafId: pane.leafId,
      ptyId: pane.ptyId
    }))
  expect(panes.length, 'the grid needs three live panes to seed three buckets').toBe(3)

  // Distinct buckets so the strip has something to count and something to filter to.
  // Written while the terminal is the visible surface: a hidden pane behind the
  // drawer does not take pty input here, and the point is the pane's real screen.
  await execInTerminal(page, panes[0].ptyId, `printf '\\033[31m${TAIL_MARKER}\\033[0m\\n'`)
  // Waited through the pane's own screen rather than the active-pane buffer:
  // the marker went to a specific split, which is not necessarily the active one.
  await expect
    .poll(
      async () =>
        page.evaluate(async (ptyId) => {
          const readings = await window.api.agentTerminalTail?.readPtys([ptyId], 24)
          const tail = readings?.[0]?.tail
          return tail && tail.read ? tail.lines.join('\n') : ''
        }, panes[0].ptyId),
      { timeout: 20_000, message: 'Marker never reached the pane screen' }
    )
    .toContain(TAIL_MARKER)

  await seedAgentStatus(page, panes[0].paneKey, 'blocked', WAITING_AGENT)
  await seedAgentStatus(page, panes[1].paneKey, 'working', WORKING_AGENT)
  await seedAgentStatus(page, panes[2].paneKey, 'done', DONE_AGENT)

  const secondProjectPaneKey = `${secondSnapshot.tabId}:${secondSnapshot.panes[0].leafId}`
  await seedAgentStatus(page, secondProjectPaneKey, 'working', SECOND_PROJECT_AGENT)

  await openAgentGrid(page)
  await expect
    .poll(() => gridCells(page).count(), {
      timeout: 30_000,
      message: 'Agent grid never rendered a cell per seeded agent'
    })
    .toBe(4)

  // ── The grid takes the height it is given ────────────────────────────────
  await page
    .getByRole('button', { name: `${SINGLE_ROW_PAGE_SIZE}`, exact: true })
    .first()
    .click()
  const floor = resolveAgentGridMinCellHeight(SINGLE_ROW_PAGE_SIZE)
  const shortHeight = await settledCellHeight(page)
  await resizeWindow(electronApp, WINDOW_WIDTH, TALL_WINDOW_HEIGHT)
  const tallHeight = await settledCellHeight(page, shortHeight)

  expect(
    tallHeight,
    'a taller window must give the cells more height, not the same fixed box'
  ).toBeGreaterThan(shortHeight + 1)
  // Both above the floor, or Math.max would be what moved and the grid could
  // still be a fixed box.
  expect(shortHeight, 'the short window must already clear the min-height floor').toBeGreaterThan(
    floor
  )
  expect(tallHeight).toBeGreaterThan(floor)

  // ── The strip counts what it shows, and filters to it ────────────────────
  const totalCells = await gridCells(page).count()
  const bucketCounts = await readBucketCounts(page)
  const countedTotal = Object.values(bucketCounts).reduce((sum, count) => sum + count, 0)
  expect(countedTotal, 'the strip must count the cells the grid renders').toBe(totalCells)

  await page
    .getByRole('button', { name: /^Waiting/ })
    .first()
    .click()
  await expect
    .poll(() => gridCells(page).count(), { message: 'Waiting filter did not narrow the grid' })
    .toBe(bucketCounts.attention)
  // By pane key, not by title: a cell's text is truncated chrome, and the point
  // is which agents survived the filter.
  await expect(cell(page, panes[0].paneKey)).toBeVisible()
  await expect(cell(page, panes[1].paneKey)).toHaveCount(0)
  // The strip keeps reporting the unfiltered totals, so the counts stay comparable.
  expect(await readBucketCounts(page)).toEqual(bucketCounts)
  await page
    .getByRole('button', { name: /^Waiting/ })
    .first()
    .click()
  await expect.poll(() => gridCells(page).count()).toBe(totalCells)

  // ── Collapsing a project hides its cells and only its cells ──────────────
  const secondProjectCollapse = page.locator(`[data-repo-collapse="${secondRepoId}"]`)
  await expect(secondProjectCollapse).toBeVisible()
  await secondProjectCollapse.click()
  await expect(cell(page, secondProjectPaneKey)).toHaveCount(0)
  await expect(cell(page, panes[0].paneKey), 'the other project must stay open').toBeVisible()
  await expect
    .poll(() => gridCells(page).count(), { message: 'Collapse hid the wrong project' })
    .toBe(totalCells - 1)
  // The collapsed project keeps its heading, so it can be brought back.
  await expect(secondProjectCollapse).toBeVisible()
  await secondProjectCollapse.click()
  await expect.poll(() => gridCells(page).count()).toBe(totalCells)

  // ── The tail is the pane's real screen, coloured where Orca owns it ──────
  const colouredPaneKey = panes[0].paneKey
  const colouredTail = cell(page, colouredPaneKey).locator('[data-terminal-tail]')
  await expect(colouredTail).toContainText(TAIL_MARKER, { timeout: 30_000 })
  const paintedColours = await cell(page, colouredPaneKey)
    .locator('[data-tail-color]')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => (node.textContent ?? '').includes('ORCA_TAIL_COLOUR'))
        .map((node) => (node as HTMLElement).dataset.tailColor ?? '')
    )
  expect(
    paintedColours,
    'the marker line came from the pane emulator, so it must carry its colour'
  ).toContain('red')

  // Every cell paints something: a blank box is how the grid failed before the
  // notice branch existed, and it is indistinguishable from "nothing to say".
  const cellTexts = await gridCells(page).evaluateAll((nodes) =>
    nodes.map((node) => (node.textContent ?? '').trim().length)
  )
  expect(cellTexts.filter((length) => length === 0)).toEqual([])

  void worktreeId
})
