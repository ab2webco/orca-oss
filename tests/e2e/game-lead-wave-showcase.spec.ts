import { rm } from 'node:fs/promises'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { claudeVersionOk, startGameBand } from './helpers/orchestrator-game-band'
import { clickOnceRedrawn, screenText } from './helpers/orchestrator-game-panel-capture'
import {
  demoLeadState,
  demoMember,
  showcaseFrame,
  sizeWindow
} from './helpers/game-showcase-demo-party'

// Source frames for the README lead flow GIF: a To Do list, a wave that fills the free slots
// with one member per ticket, then green CI and a merge paying XP.
const todoItem = (ticket: string, title: string) => ({
  id: ticket,
  title,
  url: `https://plane.example.com/lumen/browse/${ticket}/`,
  status: 'Todo',
  tone: 'neutral'
})

const todo = (tickets: [string, string][]) => ({
  provider: 'plane',
  group: 'todo',
  total: tickets.length,
  url: 'https://plane.example.com/lumen/projects/app/issues/',
  groups: { todo: tickets.length },
  actionId: 'lead:wave',
  items: tickets.map(([ticket, title]) => todoItem(ticket, title))
})

const BACKLOG: [string, string][] = [
  ['LUM-14', 'Offline cache for the feed'],
  ['LUM-15', 'Onboarding copy'],
  ['LUM-17', 'Share sheet on Android'],
  ['LUM-18', 'Retry failed uploads']
]

const wren = (ci: 'pending' | 'success', prState: 'open' | 'merged') =>
  demoMember({
    name: 'Wren',
    ticket: 'LUM-12',
    title: 'Dark mode toggle',
    state: prState === 'merged' ? 'done' : 'working',
    tool: 'Edit',
    pr: { number: 41, ci, state: prState }
  })

const launched = [
  demoMember({
    name: 'Pico',
    ticket: 'LUM-14',
    title: 'Offline cache for the feed',
    state: 'working',
    tool: 'Read'
  }),
  demoMember({ name: 'Juno', ticket: 'LUM-15', title: 'Onboarding copy', state: 'working' })
]

const extra = (tickets: [string, string][]) => ({
  project: { reviews: null, todo: todo(tickets) },
  actions: [
    {
      id: 'lead:wave',
      label: 'Wave',
      command: 'wave',
      prompt: 'Run a wave now: fill every free slot from the To Do list.'
    }
  ]
})

const steps = [
  demoLeadState([wren('pending', 'open')], extra(BACKLOG)),
  demoLeadState([wren('pending', 'open'), ...launched], extra(BACKLOG.slice(2))),
  demoLeadState([wren('success', 'merged'), ...launched], extra(BACKLOG.slice(2)))
]

test('a wave turns To Do tickets into members, and green CI and a merge pay XP', async ({
  electronApp,
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
  test.setTimeout(240_000)
  await waitForSessionReady(orcaPage)
  await sizeWindow(electronApp, 1440, 900)
  const band = await startGameBand(orcaPage, testRepoPath, {
    state: steps[0],
    theme: 'dark',
    locale: 'en'
  })
  try {
    await expect
      .poll(async () => screenText(orcaPage), {
        timeout: 60_000,
        message: 'the band never drew the seeded party'
      })
      .toContain('To Do 4')
    await clickOnceRedrawn(orcaPage, 'Panel')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toMatch(/▾ team/i)
    await clickOnceRedrawn(orcaPage, 'Widgets')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('○ To Do')
    await clickOnceRedrawn(orcaPage, '○ To Do')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toMatch(/▾ to do\s+4/i)
    await showcaseFrame(orcaPage, testInfo, '01-todo.png')

    // Why setState: the wave prompt goes to the lead's model, which this run does not call.
    await band.setState(steps[1])
    await clickOnceRedrawn(orcaPage, 'Refresh')
    // Why the count: the Panel names members by ticket, and LUM-15 was already in the To Do list.
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toMatch(/▾ team\s+4/i)
    await showcaseFrame(orcaPage, testInfo, '02-launched.png')

    await band.setState(steps[2])
    await clickOnceRedrawn(orcaPage, 'Refresh')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('merged')
    await showcaseFrame(orcaPage, testInfo, '03-merged.png')
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
