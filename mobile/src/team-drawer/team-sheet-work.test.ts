import { describe, expect, it } from 'vitest'
import { teamLeadViewOf } from './team-drawer-model'

const GB = 1024 ** 3
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

describe('the Team sheet PRs and Hosts tabs', () => {
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
      message: 'GitHub API limit reached. It retries on its own in 10 min.',
      provider: 'GitHub',
      limited: true
    })
    expect(work?.queue).toEqual({ kind: 'unavailable' })
  })

  it("lists each host's agents and memory, and an unreachable one as offline", () => {
    const work = teamLeadViewOf(
      leadState({
        hostCapacity: [
          {
            host: 'local',
            status: 'ok',
            running: 2,
            cap: 5,
            cpuCoreCount: 8,
            totalMemory: 32 * GB,
            availableMemory: 12 * GB,
            loadAverage1m: 1
          },
          {
            host: 'imac',
            status: 'ok',
            running: 1,
            cpuCoreCount: 8,
            totalMemory: 16 * GB,
            availableMemory: 2 * GB,
            loadAverage1m: 1
          },
          { host: 'contabo', status: 'unreachable', running: 0 }
        ]
      })
    )?.work
    expect(work?.machines).toMatchObject({
      kind: 'ready',
      value: [
        { host: { kind: 'local' }, running: 2, cap: 5, status: 'working' },
        { host: { kind: 'remote', name: 'imac' }, status: 'risk' },
        { host: { kind: 'remote', name: 'contabo' }, reading: { kind: 'unreachable' } }
      ]
    })
  })

  it('says an older host publishes neither, instead of claiming nothing is there', () => {
    const work = teamLeadViewOf(leadState())?.work
    expect(work?.prs).toEqual({ kind: 'unavailable' })
    expect(work?.queue).toEqual({ kind: 'unavailable' })
    expect(work?.machines).toEqual({ kind: 'unavailable' })
  })
})
