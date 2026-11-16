import { describe, expect, it } from 'vitest'
import {
  compareProjectTierEntries,
  enterProjectTier,
  nextProjectTierMemory,
  sameProjectTierMemory
} from './project-tier-order'
import type { ProjectTierMemory } from './project-tier-order'
import type { ProjectTier } from './project-urgency-tier'
import type { Row } from './row-types'

const MIN = 60_000
const AT_0800 = Date.UTC(2026, 10, 15, 8, 0)
const at = (hh: number, mm: number) => Date.UTC(2026, 10, 15, hh, mm)

type Observed = { key: string; tier: ProjectTier; activityAt: number }

function order(observed: Observed[], memory: ProjectTierMemory) {
  const entries = observed.map((project) => ({
    key: project.key,
    entry: enterProjectTier(project.key, project.tier, project.activityAt, memory)
  }))
  entries.sort((a, b) => compareProjectTierEntries(a.entry, b.entry) || a.key.localeCompare(b.key))
  const next: ProjectTierMemory = new Map(entries.map(({ key, entry }) => [key, entry]))
  return { keys: entries.map(({ key }) => key), next }
}

describe('enterProjectTier', () => {
  it('enters a new tier by its activity at that moment', () => {
    expect(enterProjectTier('p', 3, 500, new Map())).toEqual({ tier: 3, enteredAt: 500 })
    expect(enterProjectTier('p', 1, 900, new Map([['p', { tier: 3, enteredAt: 500 }]]))).toEqual({
      tier: 1,
      enteredAt: 900
    })
  })

  it('keeps its entry while the tier holds, whatever new output arrives', () => {
    expect(enterProjectTier('p', 3, 900, new Map([['p', { tier: 3, enteredAt: 500 }]]))).toEqual({
      tier: 3,
      enteredAt: 500
    })
  })
})

describe('compareProjectTierEntries', () => {
  it('sorts by tier, then the newest entry first', () => {
    expect(
      compareProjectTierEntries({ tier: 1, enteredAt: 1 }, { tier: 2, enteredAt: 9 })
    ).toBeLessThan(0)
    expect(
      compareProjectTierEntries({ tier: 3, enteredAt: 9 }, { tier: 3, enteredAt: 1 })
    ).toBeLessThan(0)
  })
})

// The pair in proposal §4: the same sidebar at 08:00 and 08:20.
describe('Needs you first, §4 example', () => {
  const at0800: Observed[] = [
    { key: 'cineco-frontend', tier: 1, activityAt: AT_0800 - 4 * MIN },
    { key: 'orca-oss', tier: 2, activityAt: at(7, 35) },
    { key: 'koombea-website', tier: 3, activityAt: AT_0800 - 12 * MIN },
    { key: 'certified-received', tier: 3, activityAt: AT_0800 - 30 * MIN },
    { key: 'koombea-ai-workflows', tier: 4, activityAt: AT_0800 - 3 * 60 * MIN }
  ]

  it('orders 08:00 by tier, then by activity inside each tier', () => {
    expect(order(at0800, new Map()).keys).toEqual([
      'cineco-frontend',
      'orca-oss',
      'koombea-website',
      'certified-received',
      'koombea-ai-workflows'
    ])
  })

  it('at 08:20 moves only cineco-prototype, into the top of Needs you', () => {
    const memory = order(at0800, new Map()).next
    const at0820: Observed[] = [
      // Same tier, same activity.
      { key: 'cineco-frontend', tier: 1, activityAt: AT_0800 - 4 * MIN },
      // CI on #1205 is still red.
      { key: 'orca-oss', tier: 2, activityAt: at(7, 35) },
      { key: 'koombea-website', tier: 3, activityAt: AT_0800 - 12 * MIN },
      // Output at 08:18, newer than koombea-website: the tier held, so it stays second.
      { key: 'certified-received', tier: 3, activityAt: at(8, 18) },
      { key: 'koombea-ai-workflows', tier: 4, activityAt: AT_0800 - 3 * 60 * MIN },
      // Was idle; hit its account limit at 08:15.
      { key: 'cineco-prototype', tier: 1, activityAt: at(8, 15) }
    ]
    expect(order(at0820, memory).keys).toEqual([
      'cineco-prototype',
      'cineco-frontend',
      'orca-oss',
      'koombea-website',
      'certified-received',
      'koombea-ai-workflows'
    ])
  })
})

describe('nextProjectTierMemory', () => {
  const header = (key: string, urgency?: { tier: ProjectTier; enteredAt: number }): Row => ({
    type: 'header',
    key,
    label: key,
    count: 1,
    tone: 'text-foreground',
    ...(urgency ? { urgency: { ...urgency, reason: null } } : {})
  })

  it('remembers each active project header and forgets the rest', () => {
    const memory = nextProjectTierMemory([
      header('repo:a', { tier: 3, enteredAt: 10 }),
      header('repo:idle'),
      header('repo:b', { tier: 1, enteredAt: 20 })
    ])
    expect([...memory]).toEqual([
      ['repo:a', { tier: 3, enteredAt: 10 }],
      ['repo:b', { tier: 1, enteredAt: 20 }]
    ])
  })

  it('compares memories by content, so an unchanged order commits nothing', () => {
    const a = new Map([['repo:a', { tier: 3 as const, enteredAt: 10 }]])
    expect(sameProjectTierMemory(a, new Map([['repo:a', { tier: 3, enteredAt: 10 }]]))).toBe(true)
    expect(sameProjectTierMemory(a, new Map([['repo:a', { tier: 2, enteredAt: 10 }]]))).toBe(false)
    expect(sameProjectTierMemory(a, new Map())).toBe(false)
  })
})
