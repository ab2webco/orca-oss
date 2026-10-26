import { rm } from 'node:fs/promises'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { getTerminalContent } from './helpers/terminal'
import { claudeVersionOk, clickTerminalText, startGameBand } from './helpers/orchestrator-game-band'

// Source frames for the README game GIF. Lead, members, tickets and PRs are invented
// demo data; see the helper for what the band needs to draw.
const WINDOW_WIDTH = 1440
const WINDOW_HEIGHT = 900
const HOLD_MS = 1_500

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

  const band = await startGameBand(orcaPage, testRepoPath, {
    state: gameState(1),
    theme: 'dark',
    locale: 'en'
  })
  try {
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
    await band.setState(gameState(2))
    await clickTerminalText(orcaPage, 'Refresh')
    await expect
      .poll(async () => getTerminalContent(orcaPage, 20_000), { timeout: 20_000 })
      .toContain('merged')
    await frame('03-xp.png')
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
