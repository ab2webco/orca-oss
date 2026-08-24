import { execSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  AGENT_GRID_MIN_CELL_WIDTH,
  resolveAgentGridMinCellHeight
} from '../../src/renderer/src/components/dashboard-popout/agent-grid-columns'
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
/** Past the 1294px the drawer sheet used to cap itself at, so a reintroduced
 *  ceiling cannot pass by accident. */
const WIDE_WINDOW_WIDTH = 2800
/** Both sample widths clear BOTH ceilings this fixes — the sheet's old 1294px and
 *  the grid's own 1600px — so restoring either pins the two measurements to the
 *  same value and the growth clause fails. A narrow sample under a ceiling still
 *  grows a little, and the control passes; verified, it did. */
const PAST_CEILING_WINDOW_WIDTH = 2000
/** Narrow enough that the four-cell section cannot keep four readable tracks, so
 *  the column count has to give: at AGENT_GRID_MIN_CELL_WIDTH 320 and gap 8 this
 *  fits three. Wider would keep four and the clause would prove nothing. */
const NARROW_WINDOW_WIDTH = 1100

const WAITING_AGENT = 'Grid waiting agent'
const WORKING_AGENT = 'Grid working agent'
const DONE_AGENT = 'Grid done agent'
const SECOND_PROJECT_AGENT = 'Second project agent'
const FOURTH_TRACK_AGENT = 'Grid fourth track agent'
const TAIL_MARKER = 'ORCA_TAIL_COLOUR'
/** Enough polls of the 1.5s batch tail reader to outlive the first read: the
 *  ORCA-285 regression only shows from the second one on. */
const TAIL_COLOUR_SAMPLES = 5
const TAIL_COLOUR_SAMPLE_GAP_MS = 1_600

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

/** Laid-out width of a cell, polled through the same ResizeObserver settle. */
async function measureFirstCellWidth(page: Page): Promise<number> {
  const box = await gridCells(page).first().boundingBox()
  if (!box) {
    throw new Error('Grid cell has no layout box')
  }
  return box.width
}

async function settledCellWidth(page: Page, differentFrom?: number): Promise<number> {
  let width = 0
  await expect
    .poll(
      async () => {
        width = await measureFirstCellWidth(page)
        return differentFrom === undefined ? width > 0 : Math.abs(width - differentFrom) > 1
      },
      { timeout: 15_000, message: 'Grid never settled on a measured cell width' }
    )
    .toBe(true)
  return width
}

/** Widest column count any section resolved. Not `.first()`: a project with one
 *  agent is capped at one track by cell count, so it never reflects the width. */
async function readGridColumns(page: Page): Promise<number> {
  const counts = await page
    .locator('[data-agent-grid-columns]')
    .evaluateAll((nodes) =>
      nodes.map((node) => Number((node as HTMLElement).dataset.agentGridColumns ?? '0'))
    )
  return Math.max(0, ...counts)
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
  // Why four and not three: resolveAgentGridColumns caps at the cell count, so a
  // three-cell section resolves three tracks at every width and the floor clause
  // below cannot tell a dropped track from a squeezed one (ORCA-286).
  await splitActiveTerminalPane(page, 'vertical')
  await waitForPaneCount(page, 4)
  const snapshot = await waitForPaneIdentitySnapshot(page, 4)

  const panes: SeededPane[] = snapshot.panes
    .filter((pane): pane is typeof pane & { ptyId: string } => Boolean(pane.ptyId))
    .map((pane) => ({
      paneKey: `${snapshot.tabId}:${pane.leafId}`,
      leafId: pane.leafId,
      ptyId: pane.ptyId
    }))
  expect(panes.length, 'the grid needs four live panes: three buckets plus a track').toBe(4)

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
  await seedAgentStatus(page, panes[3].paneKey, 'working', FOURTH_TRACK_AGENT)

  const secondProjectPaneKey = `${secondSnapshot.tabId}:${secondSnapshot.panes[0].leafId}`
  await seedAgentStatus(page, secondProjectPaneKey, 'working', SECOND_PROJECT_AGENT)

  await openAgentGrid(page)
  await expect
    .poll(() => gridCells(page).count(), {
      timeout: 30_000,
      message: 'Agent grid never rendered a cell per seeded agent'
    })
    .toBe(5)

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

  // ── The grid takes the width it is given ─────────────────────────────────
  // Same two clauses as the height, for the same reason: growth alone passes a
  // grid pinned to its minimum track, so both measurements must clear the floor
  // too (ORCA-286).
  // Both widths sit ABOVE the ceiling this fixes, so a reintroduced cap pins the
  // two measurements to the same value and the growth clause fails. Measuring
  // from WINDOW_WIDTH would leave the narrow one below the cap, where a capped
  // grid still grows a little and the control passes — verified, it did.
  await resizeWindow(electronApp, PAST_CEILING_WINDOW_WIDTH, TALL_WINDOW_HEIGHT)
  const narrowCellWidth = await settledCellWidth(page)
  await resizeWindow(electronApp, WIDE_WINDOW_WIDTH, TALL_WINDOW_HEIGHT)
  const wideCellWidth = await settledCellWidth(page, narrowCellWidth)

  expect(
    wideCellWidth,
    'a wider window must widen the cells, not centre them behind empty margins'
  ).toBeGreaterThan(narrowCellWidth + 1)
  expect(
    narrowCellWidth,
    'the narrow window must already clear the min track, or Math.max is what moved'
  ).toBeGreaterThan(AGENT_GRID_MIN_CELL_WIDTH)
  expect(wideCellWidth).toBeGreaterThan(AGENT_GRID_MIN_CELL_WIDTH)
  // The floor stays a floor: narrowing the window drops the COLUMN COUNT and
  // leaves the track above the minimum. Without this, removing the ceilings could
  // ship a grid that just shrinks its cells into unreadable slivers instead.
  const wideColumns = await readGridColumns(page)
  await resizeWindow(electronApp, NARROW_WINDOW_WIDTH, TALL_WINDOW_HEIGHT)
  // Polled, not read once: a track's width shrinks the instant the box does, but
  // the column count is React state behind the ResizeObserver, so a single read
  // races the re-render and sees the old count.
  await expect
    .poll(() => readGridColumns(page), {
      timeout: 15_000,
      message: 'a narrower window must drop tracks, not squeeze them'
    })
    .toBeLessThan(wideColumns)
  const narrowedCellWidth = await settledCellWidth(page)
  expect(
    narrowedCellWidth,
    'the surviving track must still be wide enough to read a tail'
  ).toBeGreaterThanOrEqual(AGENT_GRID_MIN_CELL_WIDTH)

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
  // Sampled, not read once: the ORCA-285 defect was that the FIRST read carried
  // colour and every read after it did not, so a single check passed against the
  // broken code. Each sample crosses a fresh poll of the batch tail reader.
  const readMarkerColours = async (): Promise<string[]> =>
    cell(page, colouredPaneKey)
      .locator('[data-tail-color]')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => (node.textContent ?? '').includes('ORCA_TAIL_COLOUR'))
          .map((node) => (node as HTMLElement).dataset.tailColor ?? '')
      )
  const colourSamples: string[][] = []
  for (let sample = 0; sample < TAIL_COLOUR_SAMPLES; sample += 1) {
    colourSamples.push(await readMarkerColours())
    await page.waitForTimeout(TAIL_COLOUR_SAMPLE_GAP_MS)
  }
  const sustained = colourSamples.filter((colours) => colours.includes('red')).length
  expect(
    sustained,
    `the marker keeps its colour on every poll, not just the first — samples: ${JSON.stringify(colourSamples)}`
  ).toBe(TAIL_COLOUR_SAMPLES)

  // Every cell paints something: a blank box is how the grid failed before the
  // notice branch existed, and it is indistinguishable from "nothing to say".
  const cellTexts = await gridCells(page).evaluateAll((nodes) =>
    nodes.map((node) => (node.textContent ?? '').trim().length)
  )
  expect(cellTexts.filter((length) => length === 0)).toEqual([])

  void worktreeId
})
