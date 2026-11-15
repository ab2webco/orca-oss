import { describe, expect, it } from 'vitest'

import { openPrCapRefusalOf, openPrWarningOf } from './orchestrator-game-open-prs'
import { DEFAULT_GAME_LEAD } from './orchestrator-game-lead'

const stateWithPrs = (total: number | null) => ({
  agents: [],
  lead: { ...DEFAULT_GAME_LEAD, cap: 2 },
  project: {
    reviews: total === null ? null : { provider: 'github', total, url: null, items: [] },
    todo: null
  }
})

describe('openPrWarningOf (ORCA-780)', () => {
  it('warns when the open PRs reach the cap, naming both numbers', () => {
    expect(openPrWarningOf(stateWithPrs(2))).toBe(
      '2 open PRs reach the cap of 2: finish them to merge before launching another ticket'
    )
  })

  it('stays silent below the cap, and when the PR list is not known', () => {
    expect(openPrWarningOf(stateWithPrs(1))).toBeNull()
    expect(openPrWarningOf(stateWithPrs(null))).toBeNull()
  })
})

describe('openPrCapRefusalOf (ORCA-1214)', () => {
  const withItems = (titles: string[]) => ({
    ...stateWithPrs(2),
    project: {
      reviews: {
        provider: 'github',
        total: 2,
        url: null,
        items: titles.map((title, n) => ({ id: `${n}`, title, url: '' }))
      },
      todo: null
    }
  })

  it('refuses at the cap, naming the flag and the ticket', () => {
    expect(openPrCapRefusalOf(stateWithPrs(2), 'CIN-12')).toBe(
      '2 open PRs reach the cap of 2: finish them to merge before launching another ticket. Merge one first, or pass --past-pr-cap "<why>" to launch CIN-12 anyway.'
    )
    expect(openPrCapRefusalOf(stateWithPrs(1), 'CIN-12')).toBeNull()
  })

  it('lets a ticket through when its own PR is open, matching the whole id', () => {
    expect(openPrCapRefusalOf(withItems(['fix: seats (cin-12)']), 'CIN-12')).toBeNull()
    expect(openPrCapRefusalOf(withItems(['fix: seats (CIN-123)']), 'CIN-12')).not.toBeNull()
    expect(openPrCapRefusalOf(withItems(['fix: seats (XCIN-12)']), 'CIN-12')).not.toBeNull()
  })
})
