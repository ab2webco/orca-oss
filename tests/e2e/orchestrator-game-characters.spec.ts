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
// Each built-in's first roster name, plain, and three of its characters by a color of their own
// (resources/claude-plugins/orca-game/hooks/scenes/<id>.ts). Quest and Beast Tamer by body color;
// the others by accessory, since their palettes recolor glyphs the build costume barely shows.
const BUILT_INS = [
  {
    id: 'quest',
    plain: 'Arthur',
    colors: { Merlin: 0x6f8fe0, Guinevere: 0xf0a0c0, Morgana: 0x9a6ad0 },
    widths: WIDTHS
  },
  {
    id: 'vigilante',
    plain: 'Nightjar',
    colors: { Vesper: 0xd83a8a, Cipher: 0x5fe0a0, Specter: 0xc8f0ff },
    widths: WIDTHS.slice(0, 2)
  },
  {
    id: 'jrpg',
    plain: 'Aerin',
    colors: { Lyra: 0xff7ab0, Corin: 0x9ae07a, Bryn: 0x3a6ad0 },
    widths: WIDTHS.slice(0, 2)
  },
  {
    id: 'tamer',
    plain: 'Pip',
    colors: { Mochi: 0xf8b8d0, Puddle: 0x5fa8e8, Thistle: 0xa06ad0 },
    widths: WIDTHS.slice(0, 2)
  }
] as const

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

const TICKETS = [
  ['LUM-12', 'Dark mode toggle'],
  ['LUM-14', 'Offline cache'],
  ['LUM-15', 'Onboarding copy'],
  ['LUM-16', 'Search filters']
] as const

const gameState = (
  definition: unknown,
  names = ['Arthur', 'Merlin', 'Morgana', 'Elaine'],
  scene = SCENE_ID
) => ({
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene },
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
    ...names.map((name, i) => {
      const [ticket, title] = TICKETS[i]!
      return member(name, ticket, title)
    })
  ],
  review: null,
  workItem: null,
  extensions: { scenes: definition ? [{ id: SCENE_ID, pluginId: 'file', definition }] : [] },
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
async function charactersPainted(
  page: Page,
  colors: Record<string, number> = OWN_COLORS
): Promise<string[]> {
  const painted = await paintedColors(page)
  return Object.entries(colors)
    .filter(([, color]) => painted.some((one) => isNear(one, color)))
    .map(([name]) => name)
}

type Capture = (name: string) => Promise<void>

async function captureBand(
  app: ElectronApplication,
  page: Page,
  capture: Capture,
  prefix: string,
  widths: readonly number[] = WIDTHS
) {
  for (const width of widths) {
    await closeSidebars(page)
    await setWindowWidth(app, page, width)
    await capture(`${prefix}-${width}.png`)
  }
}

/** Every width of the Panel, wheeled down card by card to the last member where it docks short. */
async function capturePanel(
  app: ElectronApplication,
  page: Page,
  capture: Capture,
  prefix: string,
  widths: readonly number[] = WIDTHS
) {
  for (const width of widths) {
    await closeSidebars(page)
    await setWindowWidth(app, page, width)
    await capture(`${prefix}-${width}.png`)
    for (let step = 0; !(await screenOf(page)).includes('LUM-16'); step++) {
      expect(step, `the last card never scrolled into view at ${width}px`).toBeLessThan(20)
      const point = await terminalPointOf(page, '✕')
      expect(point, 'the Panel menu is not on screen').not.toBeNull()
      await page.mouse.move(point!.x, point!.y)
      await page.mouse.wheel(0, 240)
      await capture(`${prefix}-${width}-scrolled-${step + 1}.png`)
    }
    await page.mouse.wheel(0, -4_800)
  }
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
      await captureBand(electronApp, orcaPage, capture, `band-${theme}`)

      await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)
      await clickTerminalText(orcaPage, 'Panel')
      await expect
        .poll(() => screenOf(orcaPage), { timeout: 20_000, message: 'the Panel never opened' })
        .toContain('LUM-16')
      await expect
        .poll(() => charactersPainted(orcaPage), { timeout: 20_000 })
        .toEqual(Object.keys(OWN_COLORS))
      await capturePanel(electronApp, orcaPage, capture, `panel-${theme}`)

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

for (const { id, plain, colors, widths } of BUILT_INS) {
  for (const theme of ['light', 'dark'] as const) {
    test(`the built-in ${id} draws four of its roster names as four characters (${theme})`, async ({
      electronApp,
      orcaPage,
      testRepoPath
    }, testInfo) => {
      test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
      test.setTimeout(300_000)
      await waitForSessionReady(orcaPage)
      await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)
      const roster = [plain, ...Object.keys(colors)]
      // Before: names outside the scene's roster all wear the phase costume.
      const band = await startGameBand(orcaPage, testRepoPath, {
        state: gameState(undefined, ['Rowan', 'Quill', 'Wren', 'Sable'], id),
        theme,
        locale: 'en',
        scene: id
      })
      const capture: Capture = async (name) => {
        await orcaPage.waitForTimeout(1_500)
        await orcaPage.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' })
      }
      try {
        await expect
          .poll(() => screenOf(orcaPage), { timeout: 60_000, message: 'the band never drew' })
          .toContain('Sable')
        await capture(`${id}-before-band-${theme}-1440.png`)
        expect(await charactersPainted(orcaPage, colors)).toEqual([])
        await band.setState(gameState(undefined, roster, id))
        await clickTerminalText(orcaPage, 'Refresh')
        await expect
          .poll(() => charactersPainted(orcaPage, colors), { timeout: 20_000 })
          .toEqual(Object.keys(colors))
        await captureBand(electronApp, orcaPage, capture, `${id}-band-${theme}`, widths)

        await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)
        await clickTerminalText(orcaPage, 'Panel')
        await expect
          .poll(() => screenOf(orcaPage), { timeout: 20_000, message: 'the Panel never opened' })
          .toContain('LUM-16')
        await expect
          .poll(() => charactersPainted(orcaPage, colors), { timeout: 20_000 })
          .toEqual(Object.keys(colors))
        await capturePanel(electronApp, orcaPage, capture, `${id}-panel-${theme}`, widths)
      } finally {
        await rm(band.root, { recursive: true, force: true })
      }
    })
  }
}
