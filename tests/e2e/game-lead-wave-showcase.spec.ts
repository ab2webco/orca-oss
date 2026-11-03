import { rm } from 'node:fs/promises'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { claudeVersionOk, clickTerminalText, startGameBand } from './helpers/orchestrator-game-band'
import { clickOnceRedrawn, screenText } from './helpers/orchestrator-game-panel-capture'
import {
  demoLeadState,
  demoMember,
  sizeWindow,
  statePusher
} from './helpers/game-showcase-demo-party'
import { CLIP_ARGS, showcaseClip } from './helpers/showcase-clip'
import { createShowcaseRepo } from './helpers/showcase-repo'
import { startMessagesApi } from './helpers/showcase-messages-api'

test.use({ seedTestRepo: false, orcaAppExtraArgs: CLIP_ARGS })

// The README and site lead clip: the owner presses Wave, the lead answers, one member per free
// slot starts working, then green CI and a merge pay XP.
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

const pico = (tool: string) =>
  demoMember({
    name: 'Pico',
    ticket: 'LUM-14',
    title: 'Offline cache for the feed',
    state: 'working',
    tool
  })
const juno = (tool: string) =>
  demoMember({ name: 'Juno', ticket: 'LUM-15', title: 'Onboarding copy', state: 'working', tool })

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

const WAVE_ANSWER =
  'Two slots are free. Launching LUM-14 "Offline cache for the feed" as Pico and LUM-15 ' +
  '"Onboarding copy" as Juno, each in its own worktree from main. LUM-17 and LUM-18 wait ' +
  'for the next free slot; I will report when #41 is green.'

const before = demoLeadState([wren('pending', 'open')], extra(BACKLOG))
const launched = (picoTool: string, junoTool: string, ci: 'pending' | 'success' = 'pending') =>
  demoLeadState([wren(ci, 'open'), pico(picoTool), juno(junoTool)], extra(BACKLOG.slice(2)))
const merged = demoLeadState(
  [wren('success', 'merged'), pico('Bash'), juno('Edit')],
  extra(BACKLOG.slice(2))
)

test('a wave turns To Do tickets into members, and green CI and a merge pay XP', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
  test.setTimeout(300_000)
  await waitForSessionReady(orcaPage)
  await sizeWindow(electronApp, 1440, 900)
  const api = await startMessagesApi([{ match: /run a wave/i, text: WAVE_ANSWER }])
  const band = await startGameBand(orcaPage, createShowcaseRepo(), {
    state: before,
    theme: 'dark',
    locale: 'en',
    showcase: { apiUrl: api.url }
  })
  const push = statePusher(band)
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
    await orcaPage.waitForTimeout(1_000)

    const clip = await showcaseClip(electronApp, testInfo, 'lead-wave')
    await orcaPage.waitForTimeout(1_500)
    await clickTerminalText(orcaPage, '▸ Wave')
    await expect.poll(() => api.prompts.length, { timeout: 20_000 }).toBe(1)
    await expect
      .poll(async () => screenText(orcaPage), { timeout: 20_000 })
      .toContain('each in its own worktree')

    // Why push: Orca pushes a fleet change on a launch, so the Panel redraws without a Refresh.
    await push(launched('Read', 'Read'))
    // Why the count: the Panel names members by ticket, and LUM-15 was already in the To Do list.
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toMatch(/▾ team\s+4/i)
    await orcaPage.waitForTimeout(1_800)
    await push(launched('Edit', 'Read'))
    await orcaPage.waitForTimeout(1_500)
    await push(launched('Edit', 'Edit'))
    await orcaPage.waitForTimeout(1_500)
    await push(launched('Bash', 'Edit', 'success'))
    await expect
      .poll(async () => screenText(orcaPage), { timeout: 20_000 })
      .toContain('CI is green')
    await orcaPage.waitForTimeout(2_000)
    await push(merged)
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('merged')
    await orcaPage.waitForTimeout(3_000)
    await clip.stop()
  } finally {
    await api.close()
    await rm(band.root, { recursive: true, force: true })
  }
})
