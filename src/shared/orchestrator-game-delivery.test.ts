import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseGameEvent } from './orchestrator-game-events'
import { parseGameHistoryRecord } from './orchestrator-game-history'
import {
  GAME_DELIVERY_PAGES_MAX,
  GAME_DELIVERY_PAGE_SIZE,
  gameDeliveryOf,
  gameDeliverySinceOf,
  gameMergedReviewsOf,
  withGameDelivery
} from './orchestrator-game-delivery'
import {
  GAME_METRICS_PAYLOAD_BUDGET_BYTES,
  gameDayWindowOf,
  gameMetricsSummaryOf
} from './orchestrator-game-metrics-summary'
import { GAME_CLAUDE_ACCOUNTS_MAX } from './orchestrator-game-claude-usage'

// Why recorded: GitHub's search pages for this repo on 2026-11-02, trimmed to the fields read, and
// GitHub's own merged count for each Bogota day (`merged:<start>..<end>` total_count) as the oracle.
const github = JSON.parse(
  readFileSync(
    join(__dirname, '__tests__', 'fixtures', 'orchestrator-game-recorded-github-merged.json'),
    'utf8'
  )
) as {
  recordedAt: string
  repo: string
  since: string
  timezone: string
  githubCountPerDay: Record<string, number>
  pages: { total_count: number; items: unknown[] }[]
}
const stores = JSON.parse(
  readFileSync(
    join(__dirname, '__tests__', 'fixtures', 'orchestrator-game-recorded-stores.json'),
    'utf8'
  )
) as { events: unknown[]; history: unknown[] }
const now = Date.parse(github.recordedAt)
const own = gameMetricsSummaryOf(
  {
    events: stores.events.map(parseGameEvent).filter((one) => one !== null),
    history: stores.history.map(parseGameHistoryRecord).filter((one) => one !== null)
  },
  { now, timezone: github.timezone }
)

const recordedDelivery = () =>
  gameDeliveryOf(
    { provider: 'github', repo: github.repo, since: github.since, now },
    async (page) => {
      const body = github.pages[page - 1] ?? { total_count: 0, items: [] }
      return { items: body.items, total: body.total_count }
    }
  )

describe('withGameDelivery on a recorded GitHub response', () => {
  it('reads every merged PR the search reported', async () => {
    const delivery = await recordedDelivery()
    expect(delivery.reviews).toHaveLength(github.pages[0].total_count)
    expect(delivery.complete).toBe(true)
  })

  it("counts each day exactly as GitHub's own merged count for that day", async () => {
    const summary = withGameDelivery(own, await recordedDelivery())
    expect(Object.keys(github.githubCountPerDay)).toEqual(summary.mergedPerDay.map((d) => d.day))
    for (const { day, merged } of summary.mergedPerDay) {
      expect(merged, day).toBe(github.githubCountPerDay[day])
    }
    // Why: the game's own events undercounted these same days (ORCA-950), so the source matters.
    expect(own.mergedPerDay).not.toEqual(summary.mergedPerDay)
  })

  it('takes lead time from PR open to merge over the window', async () => {
    const delivery = await recordedDelivery()
    const summary = withGameDelivery(own, delivery)
    const start = gameDayWindowOf(summary.mergedPerDay[0].day, github.timezone).since
    const inWindow = delivery.reviews.filter((one) => Date.parse(one.mergedAt) >= Date.parse(start))
    expect(summary.leadTime.measured).toBe(inWindow.length)
    const durations = inWindow
      .map((one) => Date.parse(one.mergedAt) - Date.parse(one.openedAt))
      .sort((a, b) => a - b)
    const middle = Math.floor(durations.length / 2)
    expect(summary.leadTime.medianMs).toBe(
      durations.length % 2 === 0
        ? (durations[middle - 1] + durations[middle]) / 2
        : durations[middle]
    )
  })

  it('names its source and when it was read', async () => {
    const summary = withGameDelivery(own, await recordedDelivery())
    expect(summary.source).toEqual({
      kind: 'github',
      repo: 'ab2webco/orca-oss',
      fetchedAt: github.recordedAt
    })
    expect(own.source).toEqual({ kind: 'game', fetchedAt: own.computedAt })
  })

  it('stays inside the payload budget with the source and full accounts', async () => {
    const summary = withGameDelivery(own, await recordedDelivery())
    const claudeAccounts = Array.from({ length: GAME_CLAUDE_ACCOUNTS_MAX }, (_, index) => ({
      email: `a-rather-long-account-name-${index}@example-company.com`,
      active: index === 0,
      sessionPercent: 100,
      weeklyPercent: 100
    }))
    expect(JSON.stringify({ ...summary, claudeAccounts }).length).toBeLessThanOrEqual(
      GAME_METRICS_PAYLOAD_BUDGET_BYTES
    )
  })

  it('looks back a day past the widget, so any zone sees its whole window', () => {
    const since = gameDeliverySinceOf(now)
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', github.timezone]) {
      const first = gameMetricsSummaryOf({ events: [], history: [] }, { now, timezone: zone })
        .mergedPerDay[0].day
      expect(gameDayWindowOf(first, zone).since >= since, zone).toBe(true)
    }
  })
})

describe('gameDeliveryOf', () => {
  const full = (page: number) =>
    Array.from({ length: GAME_DELIVERY_PAGE_SIZE }, (_, index) => ({
      number: page * 1000 + index,
      created_at: '2026-11-01T00:00:00Z',
      pull_request: { merged_at: '2026-11-01T01:00:00Z' }
    }))
  const base = { provider: 'github' as const, repo: 'o/r', since: '2026-10-01T00:00:00Z', now }

  it('stops at the page cap and says the read is partial', async () => {
    let reads = 0
    const delivery = await gameDeliveryOf(base, async (page) => {
      reads += 1
      return { items: full(page), total: 5000 }
    })
    expect(reads).toBe(GAME_DELIVERY_PAGES_MAX)
    expect(delivery.complete).toBe(false)
    expect(withGameDelivery(own, delivery).source?.partial).toBe(true)
  })

  it('stops once the total is read, without asking for an empty page', async () => {
    let reads = 0
    const delivery = await gameDeliveryOf(base, async (page) => {
      reads += 1
      return { items: full(page), total: GAME_DELIVERY_PAGE_SIZE }
    })
    expect(reads).toBe(1)
    expect(delivery.complete).toBe(true)
  })

  it('drops a GitLab MR merged before the window that an update brought along', async () => {
    const gitlab = { provider: 'gitlab' as const, repo: 'group/project', now }
    const delivery = await gameDeliveryOf(
      { ...gitlab, since: '2026-10-20T00:00:00Z' },
      async () => ({
        items: [
          { iid: 7, created_at: '2026-10-21T00:00:00Z', merged_at: '2026-10-22T00:00:00Z' },
          { iid: 3, created_at: '2026-09-01T00:00:00Z', merged_at: '2026-09-02T00:00:00Z' },
          { iid: 9, created_at: '2026-10-21T00:00:00Z', merged_at: null }
        ],
        total: 3
      })
    )
    expect(delivery.reviews).toEqual([
      { number: 7, openedAt: '2026-10-21T00:00:00Z', mergedAt: '2026-10-22T00:00:00Z' }
    ])
  })
})

describe('gameMergedReviewsOf', () => {
  it('skips an item with no merge time or number', () => {
    expect(
      gameMergedReviewsOf(
        [
          { number: 1, created_at: '2026-11-01T00:00:00Z', pull_request: { merged_at: null } },
          { number: 2, created_at: '2026-11-01T00:00:00Z' },
          {
            created_at: '2026-11-01T00:00:00Z',
            pull_request: { merged_at: '2026-11-01T01:00:00Z' }
          },
          null
        ],
        'github'
      )
    ).toEqual([])
  })
})
