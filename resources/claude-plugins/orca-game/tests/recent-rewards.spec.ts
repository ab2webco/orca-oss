import { describe, expect, it } from 'vitest'

import { RECENT_MAX, recentRewardsOf, withRecent } from '../hooks/recent-rewards'
import { reward } from '../hooks/rewards'

describe('recent rewards', () => {
  it('reads only well-formed rows from the store', () => {
    expect(recentRewardsOf(undefined)).toEqual([])
    expect(
      recentRewardsOf([{ label: '#1 merged', xp: 100, at: 5 }, { label: 3 }, 'x', null])
    ).toEqual([{ label: '#1 merged', xp: 100, at: 5 }])
  })

  it('puts the newest first and keeps the latest few', () => {
    const old = [{ label: 'old', xp: 10, at: 1 }]
    const awarded = [
      reward('ci-green:a', 'ci-green', '#2 CI is green'),
      reward('review-merged:a', 'review-merged', '#2 merged')
    ]
    expect(withRecent(old, awarded, 9)).toEqual([
      { label: '#2 merged', xp: 100, at: 9 },
      { label: '#2 CI is green', xp: 20, at: 9 },
      { label: 'old', xp: 10, at: 1 }
    ])
    const many = Array.from({ length: 6 }, (_, at) => reward(`m:${at}`, 'member-claimed', `m${at}`))
    expect(withRecent(old, many, 9)).toHaveLength(RECENT_MAX)
  })
})
