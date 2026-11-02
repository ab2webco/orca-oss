import { rm } from 'node:fs/promises'
import { expect, test } from './helpers/orca-app'
import { setWindowWidth } from './helpers/settings-window'
import { waitForSessionReady } from './helpers/store'
import { getTerminalContent } from './helpers/terminal'
import { claudeVersionOk, startGameBand } from './helpers/orchestrator-game-band'
import {
  captureEveryWidth,
  clickOnceRedrawn,
  screenText
} from './helpers/orchestrator-game-panel-capture'

// The project and its To Do items are invented; see the helper for what the band needs to draw.
const TODO_HEADING = '▾ To Do 12'
const TEAM_HEADING = '▾ Team 2'

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

test('the Panel shows Team alone until a person adds To Do from the Widgets menu', async ({
  electronApp,
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
  test.setTimeout(900_000)
  await waitForSessionReady(orcaPage)
  // Why 1440: the clicks need the wide menu labels, not the phone chips.
  await setWindowWidth(electronApp, orcaPage, 1440)
  const band = await startGameBand(orcaPage, testRepoPath, {
    state: gameState,
    theme: 'dark',
    locale: 'en'
  })
  try {
    // Why Wren: the band must have drawn the member before a click reaches the Panel chip.
    await expect
      .poll(async () => getTerminalContent(orcaPage, 20_000), {
        timeout: 60_000,
        message: 'the band never drew the seeded party'
      })
      .toContain('Wren')
    await clickOnceRedrawn(orcaPage, 'Panel')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('▾ Team')
    // The band's chip reads "To Do 12"; only the Panel's section heading would read "▾ To Do".
    expect(await screenText(orcaPage)).not.toContain('▾ To Do')
    await captureEveryWidth(electronApp, orcaPage, testInfo, 'panel-default', TEAM_HEADING)

    await setWindowWidth(electronApp, orcaPage, 1440)
    await expect.poll(async () => screenText(orcaPage), { timeout: 30_000 }).toContain('Widgets')
    await clickOnceRedrawn(orcaPage, 'Widgets')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('○ To Do')
    await clickOnceRedrawn(orcaPage, '○ To Do')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain(TODO_HEADING)
    await captureEveryWidth(electronApp, orcaPage, testInfo, 'panel-todo-added', TODO_HEADING)
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
