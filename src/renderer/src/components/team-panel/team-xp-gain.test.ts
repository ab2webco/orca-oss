import { describe, expect, it } from 'vitest'
import { gameCharacterLevelOf } from '../../../../shared/orchestrator-game-characters'
import type { TeamXp } from '../../../../shared/team-xp-model'
import { isTeamLevelUp, teamXpGainOf, teamXpLeftOf } from './team-xp-gain'

// Lv 17 starts at 13600 XP: 100 to reach Lv 2, then 100 x level for each one after.
const LV17 = 13_600

const xpAt = (total: number, recent: TeamXp['recent'] = []): TeamXp => ({
  ...gameCharacterLevelOf(total),
  total,
  recent
})

const done = { id: 'work-item-done:plane:ORCA-12', label: 'ORCA-12 Done', xp: 300 }
const merged = { id: 'review-merged:#41', label: '#41 merged', xp: 100 }

describe('teamXpGainOf', () => {
  // The lead's case on ORCA-1264: 200 XP to Lv 18, then +300 leaves 100 over.
  it('lands a level-up on the ledger carry-over, not on an empty bar', () => {
    const before = xpAt(LV17 + 1500, [merged])
    expect(teamXpLeftOf(before)).toBe(200)

    const gain = teamXpGainOf(before, xpAt(LV17 + 1800, [done, merged]))

    expect(gain).toEqual({
      gained: 300,
      from: { level: 17, into: 1500, need: 1700 },
      to: { level: 18, into: 100, need: 1800 },
      reason: 'ORCA-12 Done'
    })
    expect(isTeamLevelUp(gain!)).toBe(true)
    expect(teamXpLeftOf(gain!.to)).toBe(1700)
  })

  it('plays a gain inside one level with the reward the poll brought', () => {
    const gain = teamXpGainOf(xpAt(LV17 + 1400), xpAt(LV17 + 1500, [merged]))

    expect(gain).toMatchObject({ gained: 100, reason: '#41 merged' })
    expect(isTeamLevelUp(gain!)).toBe(false)
    expect(teamXpLeftOf(gain!.to)).toBe(200)
  })

  it('names no reason when the rise came with no new reward', () => {
    expect(teamXpGainOf(xpAt(100, [merged]), xpAt(200, [merged]))?.reason).toBeNull()
  })

  it('plays nothing when the total holds, falls, or a side predates totals', () => {
    expect(teamXpGainOf(xpAt(300), xpAt(300))).toBeNull()
    expect(teamXpGainOf(xpAt(300), xpAt(200))).toBeNull()
    expect(teamXpGainOf({ level: 1, into: 0, need: 100 }, xpAt(10))).toBeNull()
  })
})
