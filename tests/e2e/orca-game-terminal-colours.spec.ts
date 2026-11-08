import { rm, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { claudeVersionOk, screenRows, startGameBand } from './helpers/orchestrator-game-band'
import { startMessagesApi } from './helpers/showcase-messages-api'
import { ClaudeAgentTeamsService } from '../../src/main/runtime/claude-agent-teams-service'

// ORCA-1140: the agent terminal's heading, rule, time, question heading and live line draw
// prototype V30's colours in dark and the panel's light tokens in light, in a lead pane (Orca's
// Agent Teams env, under its tmux shim) and a member pane alike, measured on rendered pixels.
const ANSWER = 'The tests pass and the build is green.'
const ASK = 'Everything is ready to publish.\n\nShall I open the PR?'

type Look = 'dark' | 'light'
type Role = 'lead' | 'member'

// V30's values in dark; main.css's light tokens (--foreground, --muted-foreground,
// --agent-question-text, --destructive, --status-success) in light. A rule is its heading's colour
// at .28 over the pane, as V30 draws a translucent line; light has none, since xterm's 4.5:1 floor
// on a light pane darkens any line that pale.
type Part = 'head' | 'dim' | 'ask' | 'waiting' | 'done'
const EXPECTED: Record<Look, Record<Part, string> & { rule?: string; askRule?: string }> = {
  dark: {
    head: '#e6e8ec',
    rule: '#5a5d64',
    dim: '#8b93a1',
    ask: '#ffb7b8',
    askRule: '#614f55',
    waiting: '#ff6568',
    done: '#8fce8f'
  },
  light: {
    head: '#0a0a0a',
    dim: '#737373',
    ask: '#b60010',
    waiting: '#e40014',
    done: '#15803d'
  }
}
// Why a tolerance: glyph edges are blended with the background, and xterm's contrast floor nudges.
const TOLERANCE = 40

const NAMES: Record<Role, string> = { lead: 'Elaine', member: 'Castillo' }

const stateOf = (role: Role, look: Look) => ({
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
  warnings: [],
  worktree: {
    id: 'demo-wt-1140',
    path: '/work/lumen-1140',
    branch: 'main',
    displayName: role === 'member' ? 'Castillo · LUM-1140 Terminal colours' : 'main'
  },
  agents: [
    {
      paneKey: 'demo-lead',
      displayName: 'main',
      agentType: 'claude',
      state: 'working',
      toolName: null,
      isLeader: true
    }
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  lead: { autostart: false, cap: 4 },
  role,
  locale: 'en',
  appearance: look,
  leadName: NAMES.lead
})

// The env Orca gives a lead's Agent Teams pane: TMUX is its shim, which Claude Code reads as tmux.
function leadPaneEnv(): Record<string, string> {
  const { env } = new ClaudeAgentTeamsService().createLaunchEnv({
    leaderHandle: 'e2e-lead',
    baseEnv: {},
    shimDir: '/nonexistent',
    shimBin: null
  })
  const { TMUX, TMUX_PANE, TERM, COLORTERM, CLAUDE_CODE_TMUX_TRUECOLOR } = env
  return Object.fromEntries(
    Object.entries({ TMUX, TMUX_PANE, TERM, COLORTERM, CLAUDE_CODE_TMUX_TRUECOLOR }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )
}

async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

type Cells = { left: number; top: number; width: number; height: number; isRgb: boolean }

/** The screen box of `needle`'s cells (or its struck cells) on the last row holding it. */
async function cellsOf(page: Page, needle: string, struck = false): Promise<Cells | null> {
  return page.evaluate(
    ([text, isStruck]) => {
      for (const manager of window.__paneManagers?.values() ?? []) {
        const pane = manager.getActivePane?.()
        const screen = pane?.container.querySelector<HTMLElement>('.xterm-screen')
        if (!pane || !screen) {
          continue
        }
        const terminal = pane.terminal
        const buffer = terminal.buffer.active
        const rect = screen.getBoundingClientRect()
        const cellWidth = rect.width / terminal.cols
        const cellHeight = rect.height / terminal.rows
        for (let row = terminal.rows - 1; row >= 0; row--) {
          const line = buffer.getLine(buffer.viewportY + row)
          const at = line?.translateToString(true).indexOf(text) ?? -1
          if (!line || at === -1) {
            continue
          }
          let first = at
          let last = at + text.length - 1
          if (isStruck) {
            const columns = Array.from({ length: line.length }, (_, x) => x).filter(
              (x) => x > at && line.getCell(x)?.isStrikethrough()
            )
            if (columns.length === 0) {
              return null
            }
            first = columns[0]!
            last = columns.at(-1)!
          }
          return {
            left: rect.left + first * cellWidth,
            top: rect.top + row * cellHeight,
            width: (last - first + 1) * cellWidth,
            height: cellHeight,
            isRgb: line.getCell(first)?.isFgRGB() === true
          }
        }
      }
      return null
    },
    [needle, struck] as const
  )
}

const hexOf = (rgb: readonly number[]): string =>
  `#${rgb.map((one) => one.toString(16).padStart(2, '0')).join('')}`

const distanceOf = (a: string, b: string): number =>
  Math.max(
    ...[1, 3, 5].map((at) =>
      Math.abs(Number.parseInt(a.slice(at, at + 2), 16) - Number.parseInt(b.slice(at, at + 2), 16))
    )
  )

// Why a line's peak: its 1 px stroke is flanked by half-covered rows, which outnumber it.
/** The colour drawn most in a box past the glyphs' blended edges; for a line, its strongest pixel. */
async function drawnColourOf(page: Page, box: Cells, isLine: boolean): Promise<string> {
  const png = PNG.sync.read(
    await page.screenshot({
      clip: { x: box.left, y: box.top, width: box.width, height: box.height },
      animations: 'disabled'
    })
  )
  const counts = new Map<string, number>()
  for (let at = 0; at < png.data.length; at += 4) {
    const hex = hexOf([png.data[at]!, png.data[at + 1]!, png.data[at + 2]!])
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  const background = ranked[0]![0]
  const sum = (hex: string) =>
    [1, 3, 5].reduce((total, at) => total + Number.parseInt(hex.slice(at, at + 2), 16), 0)
  if (isLine) {
    return ranked.reduce(
      (peak, [hex]) => (distanceOf(hex, background) > distanceOf(peak, background) ? hex : peak),
      background
    )
  }
  return ranked.find(([hex]) => Math.abs(sum(hex) - sum(background)) > 60)?.[0] ?? background
}

const rowsOf = async (page: Page): Promise<string[]> =>
  (await screenRows(page)).map((row) => row.replace(/^⏺ /, '● '))

/** Waits for the screen to stop changing: a resize redraws the transcript for a while. */
async function steadyRows(page: Page): Promise<string[]> {
  let before = ''
  let rows: string[] = []
  await expect
    .poll(
      async () => {
        rows = await rowsOf(page)
        const now = rows.join('\n')
        const isSteady = now === before
        before = now
        return isSteady
      },
      { timeout: 20_000, intervals: [700] }
    )
    .toBe(true)
  return rows
}

/** Words cut across two rows: a row ending in a word's head and the next starting with its tail. */
function brokenWordsOf(rows: readonly string[], words: readonly string[]): string[] {
  return words.flatMap((word) =>
    rows.slice(0, -1).flatMap((row, at) => {
      const next = rows[at + 1]!.trimStart()
      return Array.from({ length: word.length - 1 }, (_, cut) => cut + 1)
        .filter((cut) => row.endsWith(word.slice(0, cut)) && next.startsWith(word.slice(cut)))
        .map(() => `${row} / ${next}`)
    })
  )
}

async function ask(page: Page, prompt: string, isDone: (rows: string[]) => boolean): Promise<void> {
  await page.keyboard.type(prompt)
  await expect
    .poll(
      async () => {
        const isAnswered = isDone(await rowsOf(page))
        if (!isAnswered) {
          await page.keyboard.press('Enter')
        }
        return isAnswered
      },
      { timeout: 60_000, intervals: [3_000], message: `no reply to "${prompt}"` }
    )
    .toBe(true)
}

const CASES: { role: Role; look: Look }[] = [
  { role: 'lead', look: 'dark' },
  { role: 'member', look: 'dark' },
  { role: 'lead', look: 'light' },
  { role: 'member', look: 'light' }
]

test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')

for (const one of CASES) {
  const label = `${one.role}-${one.look}`
  test(`the agent terminal draws its format in the expected colours (${label})`, async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    test.setTimeout(300_000)
    const name = NAMES[one.role]
    const expected = EXPECTED[one.look]
    const api = await startMessagesApi([
      { match: /How is the build/, text: ANSWER },
      { match: /What now/, text: ASK }
    ])
    await waitForSessionReady(orcaPage)
    await setWindowWidth(electronApp, orcaPage, 1440)
    const band = await startGameBand(orcaPage, testRepoPath, {
      state: stateOf(one.role, one.look),
      theme: one.look,
      locale: 'en',
      showcase: { apiUrl: api.url },
      pluginDir: process.env.ORCA_E2E_ORCA_GAME_DIR || undefined,
      ...(one.role === 'member' ? { role: 'member' as const } : { env: leadPaneEnv() })
    })
    const shoot = (shot: string) =>
      orcaPage.screenshot({ path: testInfo.outputPath(`${label}-${shot}.png`) })
    const drawn: Record<string, string> = {}
    const check = async (element: string, needle: string, colour?: string, struck = false) => {
      const box = await cellsOf(orcaPage, needle, struck)
      expect(box, `no "${needle}" on screen for ${element}`).not.toBeNull()
      expect(box!.isRgb, `${element} is not drawn in truecolor`).toBe(true)
      drawn[element] = await drawnColourOf(orcaPage, box!, struck)
      if (colour === undefined) {
        return
      }
      expect(
        distanceOf(drawn[element]!, colour),
        `${element} drew ${drawn[element]}, expected about ${colour}`
      ).toBeLessThanOrEqual(TOLERANCE)
    }
    try {
      await expect
        .poll(() => rowsOf(orcaPage), { timeout: 60_000 })
        .toContainEqual(expect.stringMatching(/❯|>/))
      await ask(orcaPage, 'How is the build?', (rows) =>
        rows.some((row) => row.startsWith(`✓ ${name} Done`))
      )
      await shoot('done-1440')
      await check('live done', `✓ ${name}`, expected.done)
      await check('heading', `${name} · working`, expected.head)
      await check('heading rule', `${name} · working`, expected.rule, true)
      await ask(orcaPage, 'What now?', (rows) =>
        rows.some((row) => row.startsWith(`◆ ${name} Waiting on you`))
      )
      await shoot('waiting-1440')
      await check('question heading', `${name} · asks you`, expected.ask)
      await check('question rule', `${name} · asks you`, expected.askRule, true)
      // In both looks the question's rule takes its pink and the working rule stays neutral.
      const cast = (hex: string) =>
        Number.parseInt(hex.slice(1, 3), 16) - Number.parseInt(hex.slice(3, 5), 16)
      expect(cast(drawn['question rule']!), JSON.stringify(drawn)).toBeGreaterThanOrEqual(
        cast(drawn['heading rule']!) + 10
      )
      await check('live waiting', `◆ ${name}`, expected.waiting)
      await check('live verb', 'Waiting on you', expected.dim)
      const heading = (await rowsOf(orcaPage)).find((row) => row.startsWith(`${name} · asks you`))
      const time = /(\d+:\d\d)$/.exec(heading ?? '')?.[1]
      expect(time, `the question heading has no time: ${heading}`).toBeDefined()
      await check('heading time', `  ${time!}`, expected.dim)

      // At 390 with the sidebar open the pane is a few columns, and no row may break a word.
      await setWindowWidth(electronApp, orcaPage, 390)
      await orcaPage.evaluate(() => window.__store!.getState().setSidebarOpen(true))
      const narrow = await steadyRows(orcaPage)
      await shoot('waiting-390')
      expect(
        narrow.some((row) => row.startsWith(name.slice(0, 2))),
        narrow.join('\n')
      ).toBe(true)
      expect(brokenWordsOf(narrow, [name, 'asks', 'working', 'Waiting'])).toEqual([])
    } finally {
      await writeFile(testInfo.outputPath(`${label}-drawn.json`), JSON.stringify(drawn, null, 2))
      await api.close()
      await rm(band.root, { recursive: true, force: true })
    }
  })
}
