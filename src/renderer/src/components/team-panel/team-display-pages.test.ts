import { describe, expect, it } from 'vitest'
import type {
  TeamMachine,
  TeamMemberCard,
  TeamMetrics,
  TeamPanelGameModel
} from '../../../../shared/team-panel-model-types'
import { teamDisplayPagesOf, type TeamDisplayPage } from './team-display-pages'

const GB = 1024 ** 3

const metrics: TeamMetrics = {
  timezone: 'UTC',
  mergedPerDay: Array.from({ length: 14 }, (_, index) => ({
    day: `2026-11-${String(index + 1).padStart(2, '0')}`,
    merged: index % 3
  })),
  mergedPerHour24h: null,
  leadTimeMedianMs: 6_120_000,
  ciGreenPercent: null,
  ciGreenPerDay: null,
  flakyChecks: null,
  accounts: [
    { email: 'active@x.test', sessionPercent: 6, weeklyPercent: 31 },
    { email: 'busy@x.test', sessionPercent: null, weeklyPercent: 88 }
  ],
  costPerDay: null
}

const member = (status: TeamMemberCard['status']): TeamMemberCard =>
  ({ paneKey: status, status, host: { kind: 'local' } }) as TeamMemberCard

const machines: TeamMachine[] = [
  {
    host: { kind: 'local' },
    running: 2,
    cap: 4,
    status: 'working',
    reading: {
      kind: 'ok',
      cpuCoreCount: 8,
      totalMemory: 16 * GB,
      availableMemory: 4 * GB,
      loadAverage1m: 2
    }
  },
  {
    host: { kind: 'remote', name: 'm1', environmentId: null, reachable: false },
    running: 0,
    cap: null,
    status: 'attention',
    reading: { kind: 'unreachable', lastSeenAt: null }
  }
]

const model = (overrides: Partial<TeamPanelGameModel> = {}): TeamPanelGameModel =>
  ({
    kind: 'team',
    members: [member('working'), member('attention'), member('idle')],
    metrics: { kind: 'ready', value: metrics },
    inbox: { kind: 'ready', value: { forYou: 2, waiting: 0, threads: 0, answered: 0 } },
    queue: { kind: 'ready', value: [{}, {}, {}] },
    machines: { kind: 'ready', value: machines },
    ...overrides
  }) as TeamPanelGameModel

const page = <K extends TeamDisplayPage['id']>(pages: TeamDisplayPage[], id: K) =>
  pages.find((one): one is Extract<TeamDisplayPage, { id: K }> => one.id === id)

describe('teamDisplayPagesOf', () => {
  it("draws V28's five pages in order", () => {
    expect(teamDisplayPagesOf(model()).map((one) => one.id)).toEqual([
      'summary',
      'delivery',
      'quality',
      'machines',
      'usage'
    ])
  })

  it('sums the summary from the team, the inbox, the queue and today', () => {
    expect(page(teamDisplayPagesOf(model()), 'summary')).toEqual({
      id: 'summary',
      active: 3,
      alerts: 2,
      queued: 3,
      mergedToday: 1,
      mergedPerHour24h: null,
      meters: { ciGreenPercent: null, sessionPercent: 6, weeklyPercent: 31 }
    })
  })

  it('counts the last seven days with the median lead time', () => {
    const delivery = page(teamDisplayPagesOf(model()), 'delivery')

    expect(delivery).toMatchObject({ id: 'delivery', merged7d: 7, leadTimeMedianMs: 6_120_000 })
    expect(delivery?.days.map((one) => one.day)).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14'
    ])
  })

  it('reads CPU from the 1 min load over the cores and RAM from what is in use', () => {
    expect(page(teamDisplayPagesOf(model()), 'machines')).toEqual({
      id: 'machines',
      rows: [
        {
          key: 'local',
          host: { kind: 'local' },
          cpuPercent: 25,
          memoryPercent: 75,
          running: 2,
          cap: 4
        },
        {
          key: 'm1',
          host: machines[1].host,
          cpuPercent: null,
          memoryPercent: null,
          running: 0,
          cap: null
        }
      ]
    })
  })

  it('lists each account by its weekly use', () => {
    expect(page(teamDisplayPagesOf(model()), 'usage')).toEqual({
      id: 'usage',
      costPerDay: null,
      accounts: [
        { email: 'active@x.test', weeklyPercent: 31 },
        { email: 'busy@x.test', weeklyPercent: 88 }
      ]
    })
  })

  it('invents nothing when the host publishes no metrics or a tab is off', () => {
    const pages = teamDisplayPagesOf(
      model({
        metrics: { kind: 'unavailable' },
        inbox: { kind: 'loading' },
        queue: null,
        machines: null
      })
    )

    expect(page(pages, 'summary')).toMatchObject({
      alerts: null,
      queued: null,
      mergedToday: null,
      meters: { ciGreenPercent: null, sessionPercent: null, weeklyPercent: null }
    })
    expect(page(pages, 'delivery')).toMatchObject({
      merged7d: null,
      days: [],
      leadTimeMedianMs: null
    })
    expect(page(pages, 'quality')).toEqual({
      id: 'quality',
      ciGreenPercent: null,
      ciGreenPerDay: null,
      flakyChecks: null
    })
    expect(page(pages, 'machines')).toEqual({ id: 'machines', rows: null })
    expect(page(pages, 'usage')).toEqual({ id: 'usage', costPerDay: null, accounts: null })
  })
})
