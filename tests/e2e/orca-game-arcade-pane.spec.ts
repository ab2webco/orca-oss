import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { execInTerminal, waitForActivePanePtyId } from './helpers/terminal'

// The arcade pane drawn by the orca-game mod inside a real Claude Code, in the app's light and dark
// theme at 1440, 768, 390 and 320 px: its jump and quit hints stay on screen, and Esc closes it.
// Needs `claude` on PATH; the API key is a dummy and the API URL points nowhere.
const WIDTHS = [1440, 768, 390, 320]
const MIN_CLAUDE = [2, 1, 287]
const DEMO_KEY = 'sk-ant-api03-arcade-demo-0000000000000000000000000000000000000'
const JUMP_HINT = 'j: jump'
const QUIT_HINT = 'q: Close'

function claudeVersionOk(): boolean {
  try {
    const out = execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 15_000 })
    const parts = (/(\d+)\.(\d+)\.(\d+)/.exec(out) ?? []).slice(1).map(Number)
    for (let i = 0; i < 3; i++) {
      if ((parts[i] ?? 0) !== MIN_CLAUDE[i]) {
        return (parts[i] ?? 0) > MIN_CLAUDE[i]!
      }
    }
    return true
  } catch {
    return false
  }
}

const GAME_STATE = {
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
  warnings: [],
  worktree: { id: 'demo-wt', path: '/work/arcade', branch: 'main', displayName: 'arcade' },
  agents: [],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  role: 'lead',
  locale: 'en'
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    const store = window.__store!
    store.setState({ settings })
    store.getState().setSidebarOpen(false)
    store.getState().setRightSidebarOpen(false)
  }, theme)
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
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

// Why the viewport rows and not the serialized buffer: scrollback keeps a closed pane's hints.
const columnsOf = (page: Page): Promise<number> =>
  page.evaluate(() => {
    for (const manager of window.__paneManagers?.values() ?? []) {
      const pane = manager.getActivePane?.()
      if (pane) {
        return pane.terminal.cols
      }
    }
    return 0
  })

const screenOf = (page: Page): Promise<string> =>
  page.evaluate(() => {
    for (const manager of window.__paneManagers?.values() ?? []) {
      const pane = manager.getActivePane?.()
      if (!pane) {
        continue
      }
      const buffer = pane.terminal.buffer.active
      const rows: string[] = []
      for (let row = 0; row < pane.terminal.rows; row++) {
        rows.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '')
      }
      return rows.join('\n')
    }
    return ''
  })

for (const theme of ['light', 'dark'] as const) {
  test(`the arcade pane keeps its key hints at every width and closes on Esc (${theme})`, async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
    test.setTimeout(240_000)
    await waitForSessionReady(orcaPage)
    await setWindowWidth(electronApp, orcaPage, WIDTHS[0]!)

    const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-game-arcade-')))
    const projectDir = join(root, 'arcade')
    const configDir = join(root, 'claude-config')
    await mkdir(projectDir)
    await mkdir(configDir)
    try {
      const trusted = { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
      await writeFile(
        join(configDir, '.claude.json'),
        JSON.stringify({
          hasCompletedOnboarding: true,
          theme,
          numStartups: 5,
          customApiKeyResponses: { approved: [DEMO_KEY.slice(-20)], rejected: [] },
          projects: { [projectDir]: trusted, [projectDir.replace(/^\/private/, '')]: trusted }
        })
      )
      const cli = join(root, 'orca-demo-cli')
      await writeFile(
        cli,
        [
          `#!${process.execPath}`,
          "if (process.argv.slice(2).join(' ') !== 'game state --json') process.exit(1)",
          `process.stdout.write(${JSON.stringify(JSON.stringify(GAME_STATE))})`,
          ''
        ].join('\n')
      )
      await chmod(cli, 0o755)
      const pluginDir = join(process.cwd(), 'resources', 'claude-plugins', 'orca-game')
      const env = {
        CLAUDE_CONFIG_DIR: configDir,
        ANTHROPIC_API_KEY: DEMO_KEY,
        // Nothing listens there: no request leaves the machine.
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
        DISABLE_AUTOUPDATER: '1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_NO_FLICKER: '1',
        ORCA_GAME_CLI: cli,
        ORCA_GAME_MODE: 'on',
        ORCA_GAME_SCENE: 'quest',
        ORCA_GAME_RENDER: 'hd',
        ORCA_GAME_TIMEZONE: 'UTC',
        ORCA_GAME_LOCALE: 'en'
      }
      const play = join(projectDir, 'play')
      await writeFile(
        play,
        `#!/bin/sh\nunset ORCA_GAME_ROLE CLAUDE_CODE_OAUTH_TOKEN\n${Object.entries(env)
          .map(([key, value]) => `export ${key}='${value}'`)
          .join('\n')}\nexec claude --plugin-dir '${pluginDir}'\n`
      )
      await chmod(play, 0o755)

      await attachRepoAndOpenTerminal(orcaPage, testRepoPath)
      await ensureTerminalVisible(orcaPage)
      await setTheme(orcaPage, theme)
      const ptyId = await waitForActivePanePtyId(orcaPage)
      await execInTerminal(orcaPage, ptyId, `PS1='$ '; cd '${projectDir}'; clear; ./play; exit`)
      await expect
        .poll(() => screenOf(orcaPage), { timeout: 60_000, message: 'Claude never started' })
        .toContain('/orca-game')

      // Each width opens its own pane: a resize is redrawn late, so hints read right after one are stale.
      for (const width of WIDTHS) {
        const before = await columnsOf(orcaPage)
        await setWindowWidth(electronApp, orcaPage, width)
        if (width !== WIDTHS[0]) {
          await expect.poll(() => columnsOf(orcaPage), { timeout: 10_000 }).not.toBe(before)
        }
        await orcaPage.waitForTimeout(1_000)
        await orcaPage.keyboard.type('/orca-game:demo arcade')
        await expect.poll(() => screenOf(orcaPage), { timeout: 20_000 }).toContain('demo arcade')
        // Why Enter again: an Enter that lands while the composer still settles the text is dropped.
        await expect
          .poll(
            async () => {
              const screen = await screenOf(orcaPage)
              if (!screen.includes(JUMP_HINT)) {
                await orcaPage.keyboard.press('Enter')
              }
              return screen
            },
            {
              timeout: 30_000,
              intervals: [2_000],
              message: `the arcade pane never opened at ${width}px`
            }
          )
          .toMatch(new RegExp(`${JUMP_HINT}[\\s\\S]*${QUIT_HINT}`))
        await orcaPage.keyboard.press('j')
        await orcaPage.waitForTimeout(1_000)
        expect(await screenOf(orcaPage), `hints after a jump at ${width}px`).toContain(QUIT_HINT)
        await orcaPage.screenshot({
          path: testInfo.outputPath(`arcade-pane-${width}-${theme}.png`),
          animations: 'disabled'
        })

        await orcaPage.keyboard.press('Escape')
        await expect
          .poll(() => screenOf(orcaPage), {
            timeout: 20_000,
            message: `Esc left the pane open at ${width}px`
          })
          .not.toContain(JUMP_HINT)
        await orcaPage.screenshot({
          path: testInfo.outputPath(`arcade-pane-${width}-${theme}-closed.png`),
          animations: 'disabled'
        })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}
