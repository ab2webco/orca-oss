import { describe, expect, it } from 'vitest'

import { openPrWarningOf } from './orchestrator-game-open-prs'
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
