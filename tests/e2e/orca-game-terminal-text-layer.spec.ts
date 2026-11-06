import { rm } from 'node:fs/promises'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { claudeVersionOk, screenRows, startGameBand } from './helpers/orchestrator-game-band'
import { startMessagesApi } from './helpers/showcase-messages-api'

// ORCA-1055: the native Team panel replaced the terminal game UI, so a lead or member pane draws
// V28's center column only: reply headings, tool lines, Claude's own live line, prompt and status.
const WIDTHS = [1440, 768, 390, 320]
// The band's glyphs: Panel ▤, Refresh ↻, Pet ♥, the team chip ⚑, and the scene's raster blocks.
const BAND_MARKS = /[▤↻♥⚑▀▄▌▐]/

const WORDS = {
  en: { prompt: 'How is the build?', answer: 'The build is green and PR 41 is in review.' },
  es: {
    prompt: '¿Cómo va el build?',
    answer: 'El build está en verde y el PR 41 está en revisión.'
  }
} as const

const member = (name: string, ticket: string, state: 'working' | 'waiting', pr: number | null) => ({
  paneKey: `demo-${name.toLowerCase()}`,
  displayName: name,
  agentType: 'claude',
  state,
  toolName: state === 'working' ? 'Edit' : null,
  isLeader: false,
  isMember: true,
  worktree: { id: `wt-${ticket}`, branch: `feat/${ticket.toLowerCase()}`, displayName: ticket },
  workItem: {
    provider: 'plane',
    identifier: ticket,
    title: `${ticket} work`,
    url: `https://plane.example.com/lumen/browse/${ticket}/`,
    status: 'In Progress',
    statusGroup: 'in_progress'
  },
  ...(pr === null
    ? {}
    : {
        review: {
          provider: 'github',
          number: pr,
          title: `${ticket} work`,
          url: `https://github.example.com/lumen/app/pull/${pr}`,
          state: 'open',
          ci: 'pending'
        }
      })
})

// Everything the band drew: a party, a PR, someone who needs the user, lead and project buttons.
const stateOf = (role: 'lead' | 'member', locale: 'en' | 'es') => ({
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
  warnings: [],
  worktree: {
    id: 'wt-lead',
    path: '/work/lumen-app',
    branch: 'main',
    displayName: role === 'member' ? 'Castillo · LUM-12 Dark mode' : 'lumen-app'
  },
  agents: [
    {
      paneKey: 'demo-atlas',
      displayName: 'Atlas',
      agentType: 'claude',
      state: 'working',
      toolName: 'Read',
      isLeader: true
    },
    member('Wren', 'LUM-12', 'working', 41),
    member('Pico', 'LUM-14', 'waiting', null)
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  actions: [
    { id: 'lead:wave', label: 'Wave', prompt: 'Start a wave' },
    { id: 'lead:status', label: 'Status', prompt: 'Report status' },
    { id: 'lead:stop', label: 'Stop', prompt: 'Stop the team' },
    { id: 'board', label: 'Board', prompt: 'Open the board' }
  ],
  lead: { autostart: false, cap: 4, label: 'Atlas' },
  role,
  locale
})

async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
  await page.evaluate(() => {
    const store = window.__store!
    store.getState().setSidebarOpen(false)
    store.getState().setRightSidebarOpen(false)
  })
}

/** Two equal reads in a row: a resize repaints the transcript for a while. */
async function steadyRows(page: Page): Promise<string[]> {
  let before = ''
  let rows: string[] = []
  await expect
    .poll(
      async () => {
        rows = await screenRows(page)
        const now = rows.join('\n')
        const isSteady = now === before
        before = now
        return isSteady
      },
      { timeout: 20_000, intervals: [500] }
    )
    .toBe(true)
  return rows
}

const CASES = [
  { role: 'lead' as const, theme: 'dark' as const, locale: 'en' as const, name: 'Atlas' },
  { role: 'lead' as const, theme: 'light' as const, locale: 'es' as const, name: 'Atlas' },
  { role: 'member' as const, theme: 'light' as const, locale: 'en' as const, name: 'Castillo' }
]

for (const one of CASES) {
  const label = `${one.role}-${one.theme}-${one.locale}`
  test(`a ${one.role} pane draws only the text layer (${label})`, async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
    test.setTimeout(300_000)
    const words = WORDS[one.locale]
    const api = await startMessagesApi([
      { match: new RegExp(words.prompt.replace(/[?¿]/g, '.')), text: words.answer }
    ])
    await waitForSessionReady(orcaPage)
    await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)
    const band = await startGameBand(orcaPage, testRepoPath, {
      state: stateOf(one.role, one.locale),
      theme: one.theme,
      locale: one.locale,
      showcase: { apiUrl: api.url },
      // Why: ORCA_E2E_ORCA_GAME_DIR runs another build of the mod, as a before for the same checks.
      pluginDir: process.env.ORCA_E2E_ORCA_GAME_DIR || undefined,
      ...(one.role === 'member' ? { role: 'member' as const } : {})
    })
    try {
      await expect
        .poll(async () => (await screenRows(orcaPage)).join('\n'), { timeout: 60_000 })
        .toMatch(/❯|>/)
      // Why: the band draws after the mod's first state read; judging before it proves nothing.
      await expect.poll(() => band.reads(), { timeout: 30_000 }).toBeGreaterThan(0)
      await orcaPage.keyboard.type(words.prompt)
      await expect
        .poll(
          async () => {
            const screen = (await screenRows(orcaPage)).join('\n')
            const isAnswered = screen.includes(words.answer.split(' ').slice(0, 3).join(' '))
            if (!isAnswered) {
              await orcaPage.keyboard.press('Enter')
            }
            return isAnswered
          },
          { timeout: 60_000, intervals: [3_000] }
        )
        .toBe(true)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        const rows = await steadyRows(orcaPage)
        await orcaPage.screenshot({
          path: testInfo.outputPath(`${label}-${width}.png`),
          animations: 'disabled'
        })
        await testInfo.attach(`${label}-${width}.txt`, {
          body: rows.join('\n'),
          contentType: 'text/plain'
        })
        // Why from the first prompt: Claude Code's own logo is drawn in block characters.
        const transcript = rows.slice(
          Math.max(
            0,
            rows.findIndex((row) => row.startsWith('❯ '))
          )
        )
        const screen = transcript.join('\n')
        expect(transcript, `no reply heading at ${width}px:\n${screen}`).toContainEqual(
          expect.stringMatching(new RegExp(`^${one.name} · `))
        )
        expect(screen, `the band is still drawn at ${width}px:\n${screen}`).not.toMatch(BAND_MARKS)
        expect(screen).not.toContain('#41')
        expect(screen).not.toMatch(/\bPanel\b/)
      }
    } finally {
      await api.close()
      await rm(band.root, { recursive: true, force: true })
    }
  })
}
