import { rm } from 'node:fs/promises'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { claudeVersionOk, screenRows, startGameBand } from './helpers/orchestrator-game-band'

// The lead's band with four working members and five ghosts the host lists first (ORCA-886): the
// slots go to the working members, most recent first, each in its quest roster look, and the +N
// counts what was not drawn.
const WIDTHS = [1440, 768, 390, 320]
const WORKING = ['Merlin', 'Lancelot', 'Guinevere', 'Gawain']
const GHOSTS = ['ORCA-854', 'ORCA-855', 'ORCA-857', 'ORCA-861a', 'ORCA-861b']
// Why wide rows of half blocks: the turn banner is the hd scene, wider than Claude's own logo.
const BANNER_CELLS = 30
const hasBanner = (screen: string): boolean =>
  screen.split('\n').some((row) => (row.match(/[▀▄]/g) ?? []).length >= BANNER_CELLS)

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 30, 13, minutes)).toISOString()

const member = (name: string, state: 'working' | 'idle' | 'done', patch: object = {}) => ({
  paneKey: `demo-${name.toLowerCase()}`,
  displayName: name,
  agentType: 'claude',
  state,
  toolName: state === 'working' ? 'Edit' : null,
  isLeader: false,
  isMember: true,
  ...patch
})

const ghost = (name: string, host: string, state: 'idle' | 'done') =>
  member(name, state, {
    paneKey: `remote:${name.toLowerCase()}`,
    remote: { host, stateKnown: false }
  })

const working = (name: string, minutes: number, host?: string) =>
  member(name, 'working', {
    lastActivityAt: at(minutes),
    ...(host ? { paneKey: `remote:${name.toLowerCase()}`, remote: { host, stateKnown: true } } : {})
  })

const leadState = () => ({
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
  warnings: [],
  worktree: { id: 'demo-wt-lead', path: '/work/orca', branch: 'main', displayName: 'orca' },
  agents: [
    {
      paneKey: 'demo-lead',
      displayName: 'Atlas',
      agentType: 'claude',
      state: 'working',
      toolName: 'Read',
      isLeader: true
    },
    ghost('ORCA-854', 'imac', 'idle'),
    ghost('ORCA-855', 'imac', 'idle'),
    ghost('ORCA-857', 'imac', 'idle'),
    ghost('ORCA-861a', 'm1', 'done'),
    ghost('ORCA-861b', 'm1', 'done'),
    member('Percival', 'done'),
    working('Gawain', 1),
    working('Merlin', 4, 'imac'),
    working('Lancelot', 3, 'imac'),
    working('Guinevere', 2, 'imac')
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
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

// Why per width: a late startup write can reopen the right sidebar and squeeze the terminal.
async function closeSidebars(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store!
    store.getState().setSidebarOpen(false)
    store.getState().setRightSidebarOpen(false)
  })
}

const screenOf = async (page: Page): Promise<string> => (await screenRows(page)).join('\n')

for (const theme of ['dark', 'light'] as const) {
  test(`the lead band draws its working members, not its ghosts (${theme})`, async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
    test.setTimeout(420_000)
    await waitForSessionReady(orcaPage)
    await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)
    const band = await startGameBand(orcaPage, testRepoPath, {
      state: leadState(),
      theme,
      locale: 'en'
    })
    const shoot = async (name: string) =>
      orcaPage.screenshot({
        path: testInfo.outputPath(`${theme}-${name}.png`),
        animations: 'disabled'
      })
    try {
      await expect
        .poll(() => screenOf(orcaPage), { timeout: 60_000, message: 'the lead band never drew' })
        .toContain('Panel')
      for (const width of WIDTHS) {
        await closeSidebars(orcaPage)
        await setWindowWidth(electronApp, orcaPage, width)
        // Why Merlin: the most recent working member takes the first slot at every width.
        await expect.poll(() => screenOf(orcaPage), { timeout: 20_000 }).toContain('Merlin')
        await orcaPage.waitForTimeout(1_500)
        const screen = await screenOf(orcaPage)
        const columns = await orcaPage.evaluate(
          () => [...(window.__paneManagers?.values() ?? [])][0]?.getActivePane?.()?.terminal.cols
        )
        const drawn = WORKING.filter((name) => screen.includes(name))
        testInfo.annotations.push({
          type: `${theme} ${width}px`,
          description: `${columns} columns; working drawn: ${drawn.join(', ')}`
        })
        for (const name of GHOSTS) {
          expect(screen, `${name} took a slot at ${width}px`).not.toContain(name)
        }
        // Drawn working members are always the most recent ones, in order.
        expect(drawn).toEqual(WORKING.slice(0, drawn.length))
        expect(screen).toMatch(/\+\d+/)
        if (width === 1440) {
          expect(drawn).toEqual(WORKING)
        }
        await shoot(`band-${width}`)
      }
      await closeSidebars(orcaPage)
      await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)

      // The API URL points nowhere, so the turn keeps retrying and its scene banner stays on screen.
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
    } finally {
      // Why retries: Claude can still be writing its plugin cache while the folder goes.
      await rm(band.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
}
