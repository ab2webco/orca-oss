import { rm } from 'node:fs/promises'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { claudeVersionOk, startGameBand } from './helpers/orchestrator-game-band'
import { clickOnceRedrawn, screenText } from './helpers/orchestrator-game-panel-capture'
import { demoLeadState, demoMember, sizeWindow } from './helpers/game-showcase-demo-party'
import { CLIP_ARGS, showcaseClip } from './helpers/showcase-clip'
import { createShowcaseRepo } from './helpers/showcase-repo'

test.use({ seedTestRepo: false, orcaAppExtraArgs: CLIP_ARGS })

// The README and site metrics clip: the owner opens the Panel on the lead's PRs, then the
// Metrics widget with merges per day, lead time and account quota.
const DAY_MS = 86_400_000
const merged = [2, 4, 3, 0, 1, 5, 6, 3, 4, 2, 0, 3, 7, 5]
const today = Date.now()

const pr = (number: number, title: string, status: string, tone: string) => ({
  id: `#${number}`,
  title,
  url: `https://github.example.com/lumen/app/pull/${number}`,
  status,
  tone
})

const state = demoLeadState(
  [
    demoMember({
      name: 'Wren',
      ticket: 'LUM-12',
      title: 'Dark mode toggle',
      state: 'working',
      tool: 'Edit',
      pr: { number: 41, ci: 'pending', state: 'open' }
    }),
    demoMember({
      name: 'Pico',
      ticket: 'LUM-14',
      title: 'Offline cache for the feed',
      state: 'working',
      tool: 'Bash',
      pr: { number: 42, ci: 'success', state: 'open' }
    })
  ],
  {
    project: {
      reviews: {
        provider: 'github',
        total: 3,
        url: 'https://github.example.com/lumen/app/pulls',
        items: [
          pr(42, 'Offline cache for the feed', 'CI green', 'success'),
          pr(41, 'Dark mode toggle', 'CI running', 'pending'),
          pr(38, 'Settings search', 'Changes requested', 'danger')
        ]
      },
      todo: null
    },
    metrics: {
      mergedPerDay: merged.map((count, index) => ({
        day: new Date(today - (merged.length - 1 - index) * DAY_MS).toISOString().slice(0, 10),
        merged: count
      })),
      leadTime: { medianMs: 4.6 * 3_600_000, measured: 31 },
      claudeAccounts: [
        { email: 'lead@example.com', active: true, sessionPercent: 38, weeklyPercent: 54 },
        { email: 'build@example.com', active: false, sessionPercent: 12, weeklyPercent: 71 },
        { email: 'spare@example.com', active: false, sessionPercent: null, weeklyPercent: 93 }
      ],
      source: { kind: 'game', fetchedAt: new Date(today).toISOString() }
    }
  }
)

test("the Panel shows the lead's PRs, merges per day, lead time and accounts", async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
  test.setTimeout(240_000)
  await waitForSessionReady(orcaPage)
  await sizeWindow(electronApp, 1440, 900)
  const band = await startGameBand(orcaPage, createShowcaseRepo(), {
    state,
    theme: 'dark',
    locale: 'en',
    showcase: {}
  })
  try {
    await expect
      .poll(async () => screenText(orcaPage), {
        timeout: 60_000,
        message: 'the band never drew the seeded party'
      })
      .toContain('Pico')
    await orcaPage.waitForTimeout(1_000)
    const clip = await showcaseClip(electronApp, testInfo, 'panel-metrics')
    await orcaPage.waitForTimeout(1_000)
    await clickOnceRedrawn(orcaPage, 'Panel')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toMatch(/▾ my prs/i)
    await orcaPage.waitForTimeout(1_500)

    await clickOnceRedrawn(orcaPage, 'Widgets')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('○ Metrics')
    await clickOnceRedrawn(orcaPage, '○ Metrics')
    const total = merged.reduce((sum, one) => sum + one, 0)
    await expect
      .poll(async () => screenText(orcaPage), { timeout: 20_000 })
      .toContain(`${total} merged · 14 days`)
    await orcaPage.waitForTimeout(3_000)
    await clip.stop()
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
