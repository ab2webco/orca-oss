import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import {
  claudeVersionOk,
  clickTerminalText,
  screenRows,
  terminalPointOf,
  startGameBand
} from './helpers/orchestrator-game-band'
import { parseOrchestratorGameScene } from '../../src/shared/orchestrator-game-scene'

// Four members in one phase drawn by the orca-game mod as four roster characters: one plain name in
// the phase costume, two variants and one with costumes of its own, on the band and the Panel.
const WIDTHS = [1440, 768, 390, 320]
const SCENE_ID = 'file:.orca/scenes/characters.json'
const MERLIN = 0x5f8fd7
const MORGANA = 0x7a2a8a
const ELAINE = 0xf878f8
const OWN_COLORS = { Merlin: MERLIN, Morgana: MORGANA, Elaine: ELAINE }

const princess = {
  rows: ['...YYYY...', '..YYYYYY..', '..PSSSSP..', '..SESSES..', '.PPPPPPPP.', '..PPPPPP..'],
  legs: ['..P....P..', '.P......P.'],
  colors: { Y: '#fcd800', P: '#f878f8', S: '#fca044', E: '#000000' }
}

async function sceneDefinition(): Promise<Record<string, unknown>> {
  const template = JSON.parse(
    await readFile(join(process.cwd(), 'src/shared/orchestrator-game-scene-template.json'), 'utf8')
  )
  const phases = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']
  const text = JSON.stringify({
    ...template,
    roster: [
      'Arthur',
      { name: 'Merlin', variant: { colors: { O: MERLIN }, accessory: 'crown' } },
      { name: 'Morgana', variant: { accessory: 'horns', accessoryColor: MORGANA } },
      { name: 'Elaine', costumes: Object.fromEntries(phases.map((one) => [one, princess])) }
    ]
  })
  const parsed = parseOrchestratorGameScene(text, SCENE_ID)
  expect(parsed.ok && parsed.warnings).toEqual([])
  return parsed.ok ? JSON.parse(JSON.stringify(parsed.definition)) : {}
}

const member = (name: string, ticket: string, title: string) => ({
  paneKey: `demo-${name.toLowerCase()}`,
  displayName: `${name} · ${ticket} ${title}`,
  agentType: 'claude',
  state: 'working',
  toolName: 'Edit',
  isLeader: false,
  isMember: true,
  worktree: { id: `demo-wt-${ticket}`, branch: `feat/${ticket.toLowerCase()}`, displayName: ticket }
})

const gameState = (definition: unknown) => ({
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: SCENE_ID },
  warnings: [],
  worktree: { id: 'demo-wt-lead', path: '/work/lumen-app', branch: 'main', displayName: 'lumen' },
  agents: [
    {
      paneKey: 'demo-lead',
      displayName: 'Atlas',
      agentType: 'claude',
      state: 'working',
      toolName: 'Read',
      isLeader: true
    },
    member('Arthur', 'LUM-12', 'Dark mode toggle'),
    member('Merlin', 'LUM-14', 'Offline cache'),
    member('Morgana', 'LUM-15', 'Onboarding copy'),
    member('Elaine', 'LUM-16', 'Search filters')
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [{ id: SCENE_ID, pluginId: 'file', definition }] },
  links: [],
  activity: null,
  role: 'lead',
  locale: 'en'
})

/** The main window floors at 600px, so phone widths need the floor lifted first. */
async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

async function closeSidebars(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store!
    store.getState().setSidebarOpen(false)
    store.getState().setRightSidebarOpen(false)
  })
}

const screenOf = async (page: Page): Promise<string> => (await screenRows(page)).join(' ')

/** Every true color the active terminal paints, foreground and background. */
async function paintedColors(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const colors = new Set<number>()
    for (const manager of window.__paneManagers?.values() ?? []) {
      const terminal = manager.getActivePane?.()?.terminal
      if (!terminal) {
        continue
      }
      const buffer = terminal.buffer.active
      for (let row = 0; row < terminal.rows; row++) {
        const line = buffer.getLine(buffer.viewportY + row)
        for (let x = 0; x < terminal.cols; x++) {
          const cell = line?.getCell(x)
          if (cell?.isFgRGB()) {
            colors.add(cell.getFgColor())
          }
          if (cell?.isBgRGB()) {
            colors.add(cell.getBgColor())
          }
        }
      }
    }
    return [...colors]
  })
}

const channels = (color: number): number[] => [16, 8, 0].map((shift) => (color >> shift) & 0xff)
// Why near, not equal: the terminal raster paints each channel in steps of 17.
const isNear = (a: number, b: number): boolean =>
  channels(a).every((one, i) => Math.abs(one - (channels(b)[i] ?? 0)) <= 9)

/** Which of the characters' own colors the terminal paints. */
async function charactersPainted(page: Page): Promise<string[]> {
  const painted = await paintedColors(page)
  return Object.entries(OWN_COLORS)
    .filter(([, color]) => painted.some((one) => isNear(one, color)))
    .map(([name]) => name)
}

for (const theme of ['light', 'dark'] as const) {
  test(`members in one phase are drawn as their own characters on the band and Panel (${theme})`, async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
    test.setTimeout(300_000)
    await waitForSessionReady(orcaPage)
    await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)
    const definition = await sceneDefinition()
    const { characters: _characters, ...plain } = definition
    const band = await startGameBand(orcaPage, testRepoPath, {
      state: gameState(plain),
      theme,
      locale: 'en',
      scene: SCENE_ID
    })
    const capture = async (name: string): Promise<void> => {
      await orcaPage.waitForTimeout(1_500)
      await orcaPage.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' })
    }
    try {
      await expect
        .poll(() => screenOf(orcaPage), { timeout: 60_000, message: 'the band never drew' })
        .toContain('Elaine')
      // Before: the same names with no looks of their own wear the phase costume alike.
      await capture(`before-band-${theme}-1440.png`)
      expect(await charactersPainted(orcaPage)).toEqual([])
      await band.setState(gameState(definition))
      await clickTerminalText(orcaPage, 'Refresh')
      // Why these colors: each is one character's own, which no phase costume of the scene paints.
      await expect
        .poll(() => charactersPainted(orcaPage), { timeout: 20_000 })
        .toEqual(Object.keys(OWN_COLORS))
      for (const width of WIDTHS) {
        await closeSidebars(orcaPage)
        await setWindowWidth(electronApp, orcaPage, width)
        await capture(`band-${theme}-${width}.png`)
      }

      await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)
      await clickTerminalText(orcaPage, 'Panel')
      await expect
        .poll(() => screenOf(orcaPage), { timeout: 20_000, message: 'the Panel never opened' })
        .toContain('LUM-16')
      await expect
        .poll(() => charactersPainted(orcaPage), { timeout: 20_000 })
        .toEqual(Object.keys(OWN_COLORS))
      for (const width of WIDTHS) {
        await closeSidebars(orcaPage)
        await setWindowWidth(electronApp, orcaPage, width)
        await capture(`panel-${theme}-${width}.png`)
        // A phone-width Panel docks short: wheel it down card by card to the last member.
        for (let step = 0; !(await screenOf(orcaPage)).includes('LUM-16'); step++) {
          expect(step, `the last card never scrolled into view at ${width}px`).toBeLessThan(20)
          const point = await terminalPointOf(orcaPage, '✕')
          expect(point, 'the Panel menu is not on screen').not.toBeNull()
          await orcaPage.mouse.move(point!.x, point!.y)
          await orcaPage.mouse.wheel(0, 240)
          await capture(`panel-${theme}-${width}-scrolled-${step + 1}.png`)
        }
        await orcaPage.mouse.wheel(0, -4_800)
      }

      // The flat view has no sprites, so each character is a swatch of its own color.
      await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)
      await orcaPage.waitForTimeout(1_000)
      await clickTerminalText(orcaPage, 'Text')
      await expect
        .poll(async () => (await screenOf(orcaPage)).match(/■ /g)?.length ?? 0, {
          timeout: 20_000,
          message: 'the flat view never marked the characters'
        })
        .toBeGreaterThanOrEqual(3)
      for (const width of WIDTHS) {
        await closeSidebars(orcaPage)
        await setWindowWidth(electronApp, orcaPage, width)
        await capture(`flat-${theme}-${width}.png`)
      }
    } finally {
      await rm(band.root, { recursive: true, force: true })
    }
  })
}
