import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { execInTerminal, getTerminalContent, waitForActivePanePtyId } from './helpers/terminal'

// Source frames for the README game GIF. The band and Panel are drawn by the
// orca-game mod inside a real Claude Code, so this needs `claude` on PATH and is
// skipped without it. Lead, members, tickets and PRs are invented demo data,
// served by a stand-in for `orca game state --json`; the API key is a dummy and
// the API URL points nowhere.
const WINDOW_WIDTH = 1440
const WINDOW_HEIGHT = 900
const HOLD_MS = 1_500
const MIN_CLAUDE = [2, 1, 287]
const DEMO_KEY = 'sk-ant-api03-readme-demo-000000000000000000000000000000000000'

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

const member = (
  name: string,
  ticket: string,
  title: string,
  state: 'working' | 'waiting' | 'idle' | 'done',
  tool: string | null,
  pr: { number: number; ci: 'pending' | 'success' | 'failure'; state: 'open' | 'merged' } | null
) => ({
  paneKey: `demo-${name.toLowerCase()}`,
  displayName: name,
  agentType: 'claude',
  state,
  toolName: tool,
  isLeader: false,
  isMember: true,
  worktree: {
    id: `demo-wt-${ticket}`,
    branch: `feat/${ticket.toLowerCase()}`,
    displayName: ticket
  },
  workItem: {
    provider: 'plane',
    identifier: ticket,
    title,
    url: `https://plane.example.com/lumen/browse/${ticket}/`,
    status: pr?.state === 'merged' ? 'Done' : state === 'done' ? 'In Review' : 'In Progress',
    statusGroup: pr?.state === 'merged' ? 'done' : state === 'done' ? 'review' : 'in_progress'
  },
  ...(pr
    ? {
        review: {
          provider: 'github',
          number: pr.number,
          title,
          url: `https://github.example.com/lumen/app/pull/${pr.number}`,
          state: pr.state,
          ci: pr.ci
        }
      }
    : {})
})

const gameState = (step: 1 | 2) => ({
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
  warnings: [],
  worktree: {
    id: 'demo-wt-lead',
    path: '/work/lumen-app',
    branch: 'main',
    displayName: 'lumen-app'
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
    member('Wren', 'LUM-12', 'Dark mode toggle', 'working', 'Edit', {
      number: 41,
      ci: step === 1 ? 'pending' : 'success',
      state: 'open'
    }),
    member('Pico', 'LUM-14', 'Offline cache for the feed', 'waiting', null, null),
    member('Juno', 'LUM-15', 'Onboarding copy', 'done', null, {
      number: 39,
      ci: 'success',
      state: step === 1 ? 'open' : 'merged'
    })
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  role: 'lead',
  locale: 'en'
})

async function clickTerminalText(page: Page, text: string): Promise<void> {
  const point = await page.evaluate((needle) => {
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
        const line = buffer.getLine(buffer.viewportY + row)?.translateToString() ?? ''
        const col = line.indexOf(needle)
        if (col !== -1) {
          return {
            x: rect.left + (col + needle.length / 2) * cellWidth,
            y: rect.top + (row + 0.5) * cellHeight
          }
        }
      }
    }
    return null
  }, text)
  expect(point, `"${text}" is not on the terminal screen`).not.toBeNull()
  await page.mouse.click(point!.x, point!.y)
}

test('the game band and Panel draw a lead with three members', async ({
  electronApp,
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
  test.setTimeout(180_000)
  await waitForSessionReady(orcaPage)
  await electronApp.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
    },
    { width: WINDOW_WIDTH, height: WINDOW_HEIGHT }
  )

  const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-game-showcase-')))
  const projectDir = join(root, 'lumen-app')
  const configDir = join(root, 'claude-config')
  await mkdir(projectDir)
  await mkdir(configDir)
  try {
    // A fresh Claude config that skips onboarding and trusts only the demo folder.
    const trusted = { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
    await writeFile(
      join(configDir, '.claude.json'),
      JSON.stringify({
        hasCompletedOnboarding: true,
        theme: 'dark',
        numStartups: 5,
        customApiKeyResponses: { approved: [DEMO_KEY.slice(-20)], rejected: [] },
        projects: { [projectDir]: trusted, [projectDir.replace(/^\/private/, '')]: trusted }
      })
    )
    // The stand-in answers from whichever step file exists, so a later step can earn XP.
    const cli = join(root, 'orca-demo-cli')
    const stepFile = join(root, 'step-2')
    await writeFile(
      cli,
      [
        `#!${process.execPath}`,
        `const states = ${JSON.stringify([gameState(1), gameState(2)])}`,
        `const step = require('node:fs').existsSync(${JSON.stringify(stepFile)}) ? 1 : 0`,
        "if (process.argv.slice(2).join(' ') !== 'game state --json') process.exit(1)",
        'process.stdout.write(JSON.stringify(states[step]))',
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
      ORCA_GAME_SCENE: 'quest',
      ORCA_GAME_HUD: '1',
      ORCA_GAME_REWARDS: '1',
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
    await orcaPage.evaluate(async () => {
      const settings = await window.api.settings.set({ theme: 'dark' })
      const store = window.__store!
      store.setState({ settings })
      store.getState().setSidebarOpen(false)
      store.getState().setRightSidebarOpen(false)
    })
    const ptyId = await waitForActivePanePtyId(orcaPage)
    // Neutral prompt, then the demo folder; Claude's fullscreen view hides the shell after.
    await execInTerminal(orcaPage, ptyId, `PS1='$ '; cd '${projectDir}'; clear; ./play; exit`)

    await expect
      .poll(async () => getTerminalContent(orcaPage, 20_000), {
        timeout: 60_000,
        message: 'the band never drew the seeded party'
      })
      .toContain('Panel')
    const frame = async (name: string): Promise<void> => {
      await orcaPage.waitForTimeout(HOLD_MS)
      await orcaPage.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' })
    }
    await expect
      .poll(async () => getTerminalContent(orcaPage, 20_000), { timeout: 30_000 })
      .toContain('Wren')
    await frame('01-band.png')

    await clickTerminalText(orcaPage, 'Panel')
    await expect
      .poll(async () => getTerminalContent(orcaPage, 20_000), { timeout: 20_000 })
      .toContain('LUM-14')
    await frame('02-panel.png')

    // CI goes green on LUM-12 and LUM-15 merges: the next read awards the XP.
    await writeFile(stepFile, '')
    await clickTerminalText(orcaPage, 'Refresh')
    await expect
      .poll(async () => getTerminalContent(orcaPage, 20_000), { timeout: 20_000 })
      .toContain('merged')
    await frame('03-xp.png')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
