import { describe, expect, it } from 'vitest'

import type { GameActivity, GameLink, GameState } from '../types'
import { cellWidthOf } from '../hooks/cell-width'
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
