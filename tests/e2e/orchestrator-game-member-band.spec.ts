import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import {
  claudeVersionOk,
  clickTerminalText,
  screenRows,
  startGameBand
} from './helpers/orchestrator-game-band'
import { parseOrchestratorGameScene } from '../../src/shared/orchestrator-game-scene'

// A member pane drawn by the orca-game mod inside a real Claude Code (ORCA-870): its band folds to
// its menu and takes the scene banner off its turn, and its text toggle draws the turn as a line, in
// a built-in scene and a project's own scene file.
const WIDTHS = [1440, 768, 390, 320]
const FILE_SCENE = 'file:.orca/scenes/night-shift.json'
// Why wide rows of half blocks: a member band draws no HUD, and Claude's own logo is a few cells wide.
const BANNER_CELLS = 30
const hasBanner = (screen: string): boolean =>
  screen.split('\n').some((row) => (row.match(/[▀▄]/g) ?? []).length >= BANNER_CELLS)

const memberState = (scene: string, definition: unknown) => ({
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene },
  warnings: [],
  worktree: {
    id: 'demo-wt-870',
    path: '/work/lumen-870',
    branch: 'feat/lum-870',
    displayName: 'lum'
  },
  agents: [
    {
      paneKey: 'demo-rex',
      displayName: 'Rex · LUM-870 Member band folds',
      agentType: 'claude',
      state: 'working',
      toolName: 'Edit',
      isLeader: true
    }
  ],
  review: null,
  workItem: null,
  extensions: { scenes: definition ? [{ id: scene, pluginId: 'file', definition }] : [] },
  links: [],
  activity: null,
  lead: { autostart: false, cap: 4, label: 'Atlas' },
  role: 'member',
  locale: 'en'
})

async function nightShift(): Promise<unknown> {
  const text = await readFile(
    join(process.cwd(), 'examples/plugins/worklog/scenes/night-shift.json'),
    'utf8'
  )
  const parsed = parseOrchestratorGameScene(text, FILE_SCENE)
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
  return parsed.definition
}

/** The main window floors at 600px, so phone widths need the floor lifted first. */
async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

// Why per width: a late startup write can reopen the right sidebar and squeeze the terminal.
async function closeSidebars(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store!
    store.getState().setSidebarOpen(false)
    store.getState().setRightSidebarOpen(false)
  })
}

// Why apart: Expand lands where Collapse was, and two quick clicks there read as a word selection.
async function pressChip(page: Page, label: string): Promise<void> {
  await page.mouse.move(0, 0)
  await page.waitForTimeout(1_000)
  await clickTerminalText(page, label)
}

const screenOf = async (page: Page): Promise<string> => (await screenRows(page)).join('\n')

const CASES = [
  { name: 'quest', scene: 'quest', theme: 'dark' as const },
  { name: 'scene-file', scene: FILE_SCENE, theme: 'light' as const }
]

for (const one of CASES) {
  test(`a member band folds, drops its turn banner and switches to text (${one.name}, ${one.theme})`, async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
    test.setTimeout(420_000)
    await waitForSessionReady(orcaPage)
    await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)
    const definition = one.scene === FILE_SCENE ? await nightShift() : null
    const band = await startGameBand(orcaPage, testRepoPath, {
      state: memberState(one.scene, definition),
      theme: one.theme,
      locale: 'en',
      scene: one.scene
    })
    const shoot = async (name: string) =>
      orcaPage.screenshot({
        path: testInfo.outputPath(`${one.name}-${one.theme}-${name}.png`),
        animations: 'disabled'
      })
    try {
      await expect
        .poll(() => screenOf(orcaPage), { timeout: 60_000, message: 'the member band never drew' })
        .toContain('Collapse')
      for (const width of WIDTHS) {
        await closeSidebars(orcaPage)
        await setWindowWidth(electronApp, orcaPage, width)
        await expect.poll(() => screenOf(orcaPage), { timeout: 20_000 }).toContain('Rex')
        await shoot(`expanded-${width}`)
      }
      await closeSidebars(orcaPage)
      await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)

      // The API URL points nowhere, so the turn keeps retrying and its spinner stays on screen.
      await orcaPage.keyboard.type('Say hi')
      await expect
        .poll(
          async () => {
            const screen = await screenOf(orcaPage)
            if (!hasBanner(screen)) {
              await orcaPage.keyboard.press('Enter')
            }
            return hasBanner(screen)
          },
          { timeout: 60_000, intervals: [3_000], message: 'the turn never drew its scene banner' }
        )
        .toBe(true)
      await shoot('turn-banner')

      await pressChip(orcaPage, 'Collapse')
      await expect.poll(() => screenOf(orcaPage), { timeout: 20_000 }).toContain('Expand')
      await expect.poll(async () => hasBanner(await screenOf(orcaPage))).toBe(false)
      expect(await screenOf(orcaPage)).not.toContain('Rex')
      await shoot('collapsed-turn')

      await pressChip(orcaPage, 'Expand')
      await expect.poll(() => screenOf(orcaPage), { timeout: 20_000 }).toContain('Rex')
      await pressChip(orcaPage, 'Text')
      await expect.poll(() => screenOf(orcaPage), { timeout: 20_000 }).toContain('▦ Scene')
      await expect.poll(async () => hasBanner(await screenOf(orcaPage))).toBe(false)
      await shoot('text-mode-turn')
    } finally {
      await rm(band.root, { recursive: true, force: true })
    }
  })
}
