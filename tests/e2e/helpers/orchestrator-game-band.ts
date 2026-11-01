import { execFileSync } from 'node:child_process'
import { appendFile, chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import { ensureTerminalVisible } from './store'
import { attachRepoAndOpenTerminal } from './orca-restart'
import { execInTerminal, waitForActivePanePtyId } from './terminal'

// The band and Panel are drawn by the orca-game mod inside a real Claude Code, so
// specs using this need `claude` on PATH and skip without it. Game state comes from
// a stand-in for `orca game state --json` that prints whatever the spec last wrote, and
// for `orca game watch` that prints what the spec pushes; the API key is a dummy and the
// API URL points nowhere.
const MIN_CLAUDE = [2, 1, 287]
const DEMO_KEY = 'sk-ant-api03-readme-demo-000000000000000000000000000000000000'

export function claudeVersionOk(): boolean {
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

/** The screen point at the middle of the last drawn `text` in the active terminal, or null. */
export async function terminalPointOf(
  page: Page,
  text: string
): Promise<{ x: number; y: number } | null> {
  return page.evaluate((needle) => {
    for (const manager of window.__paneManagers?.values() ?? []) {
      const pane = manager.getActivePane?.()
      if (!pane) {
        continue
      }
      const terminal = pane.terminal
      const buffer = terminal.buffer.active
      const screen = pane.container.querySelector<HTMLElement>('.xterm-screen')
      if (!screen) {
        continue
      }
      const rect = screen.getBoundingClientRect()
      const cellWidth = rect.width / terminal.cols
      const cellHeight = rect.height / terminal.rows
      for (let row = terminal.rows - 1; row >= 0; row--) {
        const line = buffer.getLine(buffer.viewportY + row)
        if (!line) {
          continue
        }
        // Why cell by cell: a wide glyph before the needle shifts string indexes off the columns.
        let text = ''
        const columns: number[] = []
        for (let x = 0; x < terminal.cols; x++) {
          const cell = line.getCell(x)
          if (!cell || cell.getWidth() === 0) {
            continue
          }
          const chars = cell.getChars() || ' '
          text += chars
          columns.push(...Array.from({ length: chars.length }, () => x))
        }
        const at = text.indexOf(needle)
        if (at !== -1) {
          const first = columns[at]!
          const last = columns[at + needle.length - 1]!
          return {
            x: rect.left + ((first + last) / 2 + 0.5) * cellWidth,
            y: rect.top + (row + 0.5) * cellHeight
          }
        }
      }
    }
    return null
  }, text)
}

export async function clickTerminalText(page: Page, text: string): Promise<void> {
  const point = await terminalPointOf(page, text)
  expect(point, `"${text}" is not on the terminal screen`).not.toBeNull()
  await page.mouse.click(point!.x, point!.y)
}

/** The active terminal's visible rows, top to bottom. */
export async function screenRows(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    for (const manager of window.__paneManagers?.values() ?? []) {
      const terminal = manager.getActivePane?.()?.terminal
      if (!terminal) {
        continue
      }
      const buffer = terminal.buffer.active
      return Array.from(
        { length: terminal.rows },
        (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? ''
      )
    }
    return []
  })
}

export type GameBand = {
  root: string
  /** Replaces what the next `game state --json` read prints. */
  setState: (state: unknown) => Promise<void>
  /** How many `game state --json` reads the mod has made so far. */
  reads: () => Promise<number>
  /** Has `game watch` print `fleet <version>`, as Orca does on a fleet change. */
  pushFleetChange: (version: number) => Promise<void>
  /** Makes each `game state --json` read fail until a state is set again. */
  failReads: () => Promise<void>
}

/** Starts Claude Code with the orca-game mod in the active terminal, reading `state`. */
export async function startGameBand(
  page: Page,
  testRepoPath: string,
  options: { state: unknown; theme: 'dark' | 'light'; locale: 'en' | 'es'; scene?: string }
): Promise<GameBand> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-game-band-')))
  const projectDir = join(root, 'lumen-app')
  const configDir = join(root, 'claude-config')
  const stateFile = join(root, 'state.json')
  const readsFile = join(root, 'reads.log')
  const pushFile = join(root, 'push.log')
  await mkdir(projectDir)
  await mkdir(configDir)
  // A fresh Claude config that skips onboarding and trusts only the demo folder.
  const trusted = { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
  await writeFile(
    join(configDir, '.claude.json'),
    JSON.stringify({
      hasCompletedOnboarding: true,
      theme: options.theme,
      // Why: a click on a chip can read as a selection, which would write the real clipboard.
      copyOnSelect: false,
      numStartups: 5,
      customApiKeyResponses: { approved: [DEMO_KEY.slice(-20)], rejected: [] },
      projects: { [projectDir]: trusted, [projectDir.replace(/^\/private/, '')]: trusted }
    })
  )
  await writeFile(stateFile, JSON.stringify(options.state))
  await writeFile(readsFile, '')
  await writeFile(pushFile, '')
  const cli = join(root, 'orca-demo-cli')
  await writeFile(
    cli,
    [
      `#!${process.execPath}`,
      "const fs = require('node:fs')",
      "const argv = process.argv.slice(2).join(' ')",
      `fs.appendFileSync(${JSON.stringify(readsFile)}, argv + '\\n')`,
      "if (argv === 'game watch') {",
      "  process.stdout.write('ready 1\\n')",
      '  let sent = 0',
      '  setInterval(() => {',
      `    const pushed = fs.readFileSync(${JSON.stringify(pushFile)}, 'utf8')`,
      '    process.stdout.write(pushed.slice(sent))',
      '    sent = pushed.length',
      '  }, 50)',
      '} else {',
      "  if (argv !== 'game state --json') process.exit(1)",
      `  const state = fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8')`,
      "  if (state === 'FAIL') process.exit(1)",
      '  process.stdout.write(state)',
      '}',
      ''
    ].join('\n')
  )
  await chmod(cli, 0o755)
  const pluginDir = join(process.cwd(), 'resources', 'claude-plugins', 'orca-game')
  const env = {
    CLAUDE_CONFIG_DIR: configDir,
    ANTHROPIC_API_KEY: DEMO_KEY,
    // Nothing listens there: no request leaves the machine, and no 401 banner is drawn.
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_NO_FLICKER: '1',
    ORCA_GAME_CLI: cli,
    ORCA_GAME_MODE: 'on',
    ORCA_GAME_SCENE: options.scene ?? 'quest',
    ORCA_GAME_HUD: '1',
    ORCA_GAME_REWARDS: '1',
    ORCA_GAME_RENDER: 'hd',
    ORCA_GAME_TIMEZONE: 'UTC',
    ORCA_GAME_LOCALE: options.locale
  }
  const play = join(projectDir, 'play')
  await writeFile(
    play,
    `#!/bin/sh\nunset ORCA_GAME_ROLE CLAUDE_CODE_OAUTH_TOKEN\n${Object.entries(env)
      .map(([key, value]) => `export ${key}='${value}'`)
      .join('\n')}\nexec claude --plugin-dir '${pluginDir}'\n`
  )
  await chmod(play, 0o755)

  await attachRepoAndOpenTerminal(page, testRepoPath)
  await ensureTerminalVisible(page)
  await page.evaluate(async (theme) => {
    const settings = await window.api.settings.set({ theme })
    const store = window.__store!
    store.setState({ settings })
    store.getState().setSidebarOpen(false)
    store.getState().setRightSidebarOpen(false)
  }, options.theme)
  const ptyId = await waitForActivePanePtyId(page)
  // Neutral prompt, then the demo folder; Claude's fullscreen view hides the shell after.
  await execInTerminal(page, ptyId, `PS1='$ '; cd '${projectDir}'; clear; ./play; exit`)

  return {
    root,
    setState: (state) => writeFile(stateFile, JSON.stringify(state)),
    reads: async () =>
      (await readFile(readsFile, 'utf8')).split('\n').filter((one) => one === 'game state --json')
        .length,
    pushFleetChange: (version) => appendFile(pushFile, `fleet ${version}\n`),
    failReads: () => writeFile(stateFile, 'FAIL')
  }
}
