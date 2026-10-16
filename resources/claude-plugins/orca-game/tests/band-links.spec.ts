import { describe, expect, it } from 'vitest'

import type { GameActivity, GameLink, GameState } from '../types'
import { stateChipsOf, type BandChip } from '../hooks/band-chips'
import { cellWidthOf } from '../hooks/cell-width'
import { chipRowsOf, MORE_CHIP_KEY, type PlacedChip } from '../hooks/chip-rows'
import { needPartsOf } from '../hooks/fleet-labels'
import { needsOf } from '../hooks/party'

const tambora: GameActivity = {
  name: 'Tambora',
  id: 'TR-CIN-12',
  url: 'https://tambora.example/projects/CIN/testruns/TR-CIN-12',
  at: 2,
  running: true
}

const LINKS: GameLink[] = [
  {
    id: 'review',
    kind: 'review',
    provider: 'github',
    label: 'PR #901',
    url: 'https://github.com/o/r/pull/901',
    status: 'open',
    tone: 'pending'
  },
  {
    id: 'ci',
    kind: 'ci',
    provider: 'github',
    label: 'CI',
    url: 'https://github.com/o/r/pull/901/checks',
    status: 'failure',
    tone: 'danger'
  },
  {
    id: 'workItem',
    kind: 'workItem',
    provider: 'jira',
    label: 'CIN-123',
    url: 'https://jira.example/browse/CIN-123',
    status: 'In Progress',
    tone: 'pending'
  },
  {
    id: 'project:0',
    kind: 'project',
    provider: 'project',
    label: 'Test plan',
    url: 'https://tambora.example/projects/CIN'
  },
  {
    id: 'activity:t:builder',
    kind: 'activity',
    provider: 'Tambora',
    label: 'TR-CIN-12',
    url: tambora.url,
    status: 'running',
    tone: 'pending'
  }
]

const STATE: GameState = {
  config: {},
  warnings: [],
  worktree: { id: 'repo::/w', path: '/w', branch: 'feat/x', displayName: 'w' },
  agents: [
    {
      paneKey: 't:lead',
      displayName: 'lead',
      agentType: 'claude',
      state: 'working',
      toolName: null,
      isLeader: true
    },
    {
      paneKey: 't:builder',
      displayName: 'builder',
      agentType: 'claude',
      state: 'working',
      toolName: null,
      isLeader: false,
      activity: tambora
    },
    {
      paneKey: 't:tester',
      displayName: 'tester',
      agentType: 'claude',
      state: 'waiting',
      toolName: null,
      isLeader: false
    }
  ],
  review: {
    provider: 'github',
    number: 901,
    title: 'feat',
    url: 'https://github.com/o/r/pull/901',
    state: 'open',
    ci: 'failure'
  },
  workItem: {
    provider: 'jira',
    identifier: 'CIN-123',
    title: 'Seat map',
    url: 'https://jira.example/browse/CIN-123',
    status: 'In Progress',
    statusGroup: 'in_progress'
  },
  extensions: { scenes: [] },
  links: LINKS,
  activity: null
}

const COUNTS = { working: 1, idle: 0, done: 0, waiting: 1 }
const more = (count: number): string => `+${count}`
const chipsOf = (state: GameState): BandChip[] => stateChipsOf(state, COUNTS, 2, '', false)
const byKey = (chips: readonly BandChip[], key: string) => chips.find((one) => one.key === key)
const rowWidthOf = (row: readonly PlacedChip[]): number =>
  row.reduce((sum, chip) => sum + chip.width, 0) + Math.max(0, row.length - 1)

describe('band link chips', () => {
  it('draws the review, its CI, the work item, the activity and the project links as links', () => {
    const chips = chipsOf(STATE)
    expect(byKey(chips, 'band-review')).toMatchObject({
      labels: ['#901 open', '#901'],
      href: 'https://github.com/o/r/pull/901'
    })
    expect(byKey(chips, 'band-ci')).toMatchObject({
      labels: ['CI failing', 'CI ✗'],
      href: 'https://github.com/o/r/pull/901/checks',
      color: 'red'
    })
    expect(byKey(chips, 'band-work-item')).toMatchObject({
      labels: ['CIN-123 In Progress', 'CIN-123'],
      href: 'https://jira.example/browse/CIN-123'
    })
    expect(byKey(chips, 'band-activity-activity:t:builder')).toMatchObject({
      labels: ['▶ Tambora TR-CIN-12', '▶ TR-CIN-12'],
      href: tambora.url
    })
    expect(byKey(chips, 'band-project-project:0')).toMatchObject({
      labels: ['↗ Test plan', '↗ Test pl…'],
      href: 'https://tambora.example/projects/CIN'
    })
  })

  it('draws a finished activity without the running mark', () => {
    const done = LINKS.map((link) =>
      link.kind === 'activity' ? { ...link, status: 'done', tone: 'neutral' as const } : link
    )
    expect(
      byKey(chipsOf({ ...STATE, links: done }), 'band-activity-activity:t:builder')
    ).toMatchObject({ labels: ['Tambora TR-CIN-12', 'TR-CIN-12'] })
  })

  it("falls back to the calling pane's activity when no link carries one", () => {
    const chips = chipsOf({
      ...STATE,
      links: LINKS.filter((link) => link.kind !== 'activity'),
      activity: { ...tambora, running: false }
    })
    expect(byKey(chips, 'band-activity-own')).toMatchObject({
      labels: ['Tambora TR-CIN-12', 'TR-CIN-12'],
      href: tambora.url
    })
  })

  it('keeps the review with its CI words when an older host sends no links', () => {
    const chips = chipsOf({ ...STATE, links: [] })
    expect(byKey(chips, 'band-review')).toMatchObject({
      labels: ['#901 open · CI failing', '#901 ✗'],
      href: 'https://github.com/o/r/pull/901'
    })
    expect(byKey(chips, 'band-ci')).toBeUndefined()
    expect(chips.some((one) => one.key.startsWith('band-project-'))).toBe(false)
  })

  it('ranks the work item and review first, then CI, then activity, then project links', () => {
    const rank = (key: string) => byKey(chipsOf(STATE), key)?.priority ?? Infinity
    expect(rank('band-review')).toBeLessThanOrEqual(rank('band-work-item'))
    expect(rank('band-work-item')).toBeLessThanOrEqual(rank('band-ci'))
    expect(rank('band-ci')).toBeLessThan(rank('band-activity-activity:t:builder'))
    expect(rank('band-activity-activity:t:builder')).toBeLessThan(rank('band-project-project:0'))
  })

  for (const columns of [40, 60, 120]) {
    it(`fits whole chips in two rows at ${columns} columns, dropping the least important links first`, () => {
      const chips = chipsOf(STATE)
      const rows = chipRowsOf(chips, { columns, maxRows: 2, more })
      expect(rows.length).toBeLessThanOrEqual(2)
      for (const row of rows) {
        expect(rowWidthOf(row)).toBeLessThanOrEqual(columns)
        for (const placed of row) {
          if (placed.key !== MORE_CHIP_KEY) {
            expect(byKey(chips, placed.key)?.labels).toContain(placed.label)
          }
        }
      }
      const shown = new Set(rows.flat().map((one) => one.key))
      const order = [
        'band-review',
        'band-work-item',
        'band-ci',
        'band-activity-activity:t:builder',
        'band-project-project:0'
      ]
      const kept = order.map((key) => shown.has(key))
      // Once a link is dropped, every less important one is dropped too.
      expect(kept.slice(kept.includes(false) ? kept.indexOf(false) : kept.length)).not.toContain(
        true
      )
      expect(shown.has('band-review') && shown.has('band-work-item')).toBe(true)
      if (columns === 120) {
        expect(kept).toEqual([true, true, true, true, true])
      }
    })
  }
})

describe('needs line', () => {
  it("links the CI need to the review's checks page", () => {
    const parts = needPartsOf(needsOf(STATE), 120)
    expect(parts.map((one) => one.text).join('')).toBe(
      'Needs you: tester waiting on you · #901 CI failing'
    )
    expect(parts.find((one) => one.text === '#901 CI failing')?.url).toBe(
      'https://github.com/o/r/pull/901/checks'
    )
    expect(parts.filter((one) => one.url !== null)).toHaveLength(1)
  })

  it('links the CI need to the review when the host sends no CI link', () => {
    const parts = needPartsOf(needsOf({ ...STATE, links: [] }), 120)
    expect(parts.find((one) => one.url !== null)?.url).toBe('https://github.com/o/r/pull/901')
  })

  it('cuts the line to the width', () => {
    for (const columns of [20, 40, 60]) {
      const text = needPartsOf(needsOf(STATE), columns)
        .map((one) => one.text)
        .join('')
      expect(cellWidthOf(text)).toBeLessThanOrEqual(columns)
    }
  })
})
