import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './helpers/settings-window'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { execInTerminal, getTerminalContent, waitForActivePanePtyId } from './helpers/terminal'
import {
  claudeVersionOk,
  clickTerminalText,
  visibleTerminalText
} from './helpers/orca-game-terminal'

// The Panel is drawn by the orca-game mod inside a real Claude Code, so this needs `claude` on
// PATH and is skipped without it. The project and its To Do items are invented, served by a
// stand-in for `orca game state --json`; the API key is a dummy and the API URL points nowhere.
const HOLD_MS = 1_500
const DEMO_KEY = 'sk-ant-api03-widgets-demo-000000000000000000000000000000000000'
const TODO_HEADING = '▾ To Do 12'

const todoItem = (id: string, title: string) => ({
  id,
  title,
  url: `https://plane.example/${id}`,
  group: 'todo'
})

const gameState = {
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
  sources: {},
  warnings: [],
  worktree: { id: 'widgets-wt', path: '/work/lumen-app', branch: 'main', displayName: 'lumen' },
  agents: [
    {
      paneKey: 'demo-atlas',
      displayName: 'Atlas',
      agentType: 'claude',
      state: 'working',
      toolName: 'Read',
      isLeader: true
    },
    {
      paneKey: 'demo-wren',
      displayName: 'Wren',
      agentType: 'claude',
      state: 'working',
      toolName: 'Edit',
      isLeader: false,
      isMember: true,
      worktree: { id: 'demo-wt-lum-12', branch: 'feat/lum-12', displayName: 'LUM-12' },
      workItem: {
        provider: 'plane',
        identifier: 'LUM-12',
        title: 'Dark mode toggle',
        url: 'https://plane.example/LUM-12',
        status: 'In Progress',
        statusGroup: 'in_progress'
      }
    }
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  project: {
    reviews: null,
    todo: {
      provider: 'plane',
      total: 12,
      url: 'https://plane.example/todo',
      items: [
        todoItem('LUM-12', 'Dark mode toggle'),
        todoItem('LUM-14', 'Offline cache for the feed')
      ],
      groups: { todo: 12 }
    }
  },
  role: 'lead',
  locale: 'en'
}

// Why: Claude Code's terminal loses a click that lands while a pane redraws (on main too; keys are
// not lost), so each chip is clicked once, after the redraw that drew it.
const REDRAW_MS = 1_000

async function clickOnceRedrawn(page: Page, chip: string): Promise<void> {
  await page.waitForTimeout(REDRAW_MS)
  await clickTerminalText(page, chip)
}

test('the Panel shows Team alone until a person adds To Do, at every width and theme', async ({
  electronApp,
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
  test.setTimeout(900_000)
  await waitForSessionReady(orcaPage)
  // Why 1440: the first clicks need the wide menu labels, not the phone chips.
  await setWindowWidth(electronApp, orcaPage, 1440)

  const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-game-widgets-')))
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
    const cli = join(root, 'orca-demo-cli')
    await writeFile(
      cli,
      [
        `#!${process.execPath}`,
        `const state = ${JSON.stringify(gameState)}`,
        "if (process.argv.slice(2).join(' ') !== 'game state --json') process.exit(1)",
        'process.stdout.write(JSON.stringify(state))',
        ''
      ].join('\n')
    )
    await chmod(cli, 0o755)
    const pluginDir = join(process.cwd(), 'resources', 'claude-plugins', 'orca-game')
    const env = {
      CLAUDE_CONFIG_DIR: configDir,
      ANTHROPIC_API_KEY: DEMO_KEY,
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
    await orcaPage.evaluate(() => {
      const store = window.__store!
      store.getState().setSidebarOpen(false)
      store.getState().setRightSidebarOpen(false)
    })
    const ptyId = await waitForActivePanePtyId(orcaPage)
    await execInTerminal(orcaPage, ptyId, `PS1='$ '; cd '${projectDir}'; clear; ./play; exit`)

    await expect
      .poll(async () => getTerminalContent(orcaPage, 20_000), {
        timeout: 60_000,
        message: 'the band never drew the seeded party'
      })
      .toContain('Panel')
    // Why Wren: the band must have drawn the member before a click reaches the Panel chip.
    await expect
      .poll(async () => getTerminalContent(orcaPage, 20_000), { timeout: 60_000 })
      .toContain('Wren')
    await clickOnceRedrawn(orcaPage, 'Panel')
    await expect
      .poll(async () => visibleTerminalText(orcaPage), { timeout: 20_000 })
      .toContain('▾ Team')
    // The band's chip reads "To Do 12"; only the Panel's section heading would read "▾ To Do".
    expect(await visibleTerminalText(orcaPage)).not.toContain('▾ To Do')

    await clickOnceRedrawn(orcaPage, 'Widgets')
    await expect
      .poll(async () => visibleTerminalText(orcaPage), { timeout: 20_000 })
      .toContain('○ To Do')
    await clickOnceRedrawn(orcaPage, '○ To Do')
    await expect
      .poll(async () => visibleTerminalText(orcaPage), { timeout: 20_000 })
      .toContain(TODO_HEADING)

    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        await expect
          .poll(async () => visibleTerminalText(orcaPage), { timeout: 30_000 })
          .toContain('Widgets')
        await orcaPage.waitForTimeout(HOLD_MS)
        await orcaPage.screenshot({
          path: testInfo.outputPath(`panel-${theme}-${width}.png`),
          animations: 'disabled'
        })
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
