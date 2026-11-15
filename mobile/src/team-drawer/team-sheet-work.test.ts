import { describe, expect, it } from 'vitest'
import { teamLeadViewOf } from './team-drawer-model'

const NOW = Date.parse('2026-11-14T12:00:00Z')

const leadState = (over: Record<string, unknown> = {}) => ({
  role: 'lead',
  lead: { autostart: false, cap: 5, agent: 'claude' },
  agents: [],
  ...over
})

const project = {
  reviews: {
    total: 2,
    url: 'https://github.com/acme/web/pulls',
    items: [
      { id: '#416', title: 'Webhook signature check', url: 'u416', status: 'success' },
      { id: '#415', title: 'Rate limit dashboard', url: 'u415', status: 'failure' }
    ]
  },
  todo: null,
  queue: {
    provider: 'github',
    entries: [
      {
        id: '#409',
        title: 'Checkout copy review',
        url: 'u409',
        position: 1,
        state: 'checks',
        since: null
      },
      {
        id: '#412',
        title: 'Retry policy',
        url: 'u412',
        position: 2,
        state: 'waiting',
        since: NOW - 3 * 3_600_000
      }
    ]
  }
}

describe('the Team sheet PRs tab', () => {
  it('reads the merge queue and open PRs as the desktop panel builds them, failures first', () => {
    const work = teamLeadViewOf(leadState({ project }), new Set(), null, NOW)?.work
    expect(work?.queue).toMatchObject({
      kind: 'ready',
      value: [
        { label: '#409', state: 'checks', position: 1 },
        { label: '#412', state: 'waiting', longWaitHours: 3, status: 'risk' }
      ]
    })
    expect(work?.prs).toMatchObject({
      kind: 'ready',
      value: {
        total: 2,
        rows: [
          { label: '#415', reason: 'checksFailed', status: 'attention' },
          { label: '#416', reason: 'ready', status: 'done' }
        ]
      }
    })
  })

  it("words an unread PR list with the provider's failure, the GitHub limit included", () => {
    const work = teamLeadViewOf(
      leadState({
        project: { reviews: null, todo: null },
        githubBudget: { core: { limit: 5000, remaining: 0, resetAt: NOW / 1000 + 600 } }
      }),
      new Set(),
      null,
      NOW
    )?.work
    expect(work?.prs).toEqual({
      kind: 'error',
      message: 'GitHub API limit reached. It retries on its own in 10 min.'
    })
    expect(work?.queue).toEqual({ kind: 'unavailable' })
  })

  it('says an older host publishes neither, instead of claiming nothing is there', () => {
    const work = teamLeadViewOf(leadState())?.work
    expect(work?.prs).toEqual({ kind: 'unavailable' })
    expect(work?.queue).toEqual({ kind: 'unavailable' })
  })
})
