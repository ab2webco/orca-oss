import { describe, expect, it } from 'vitest'
import {
  creditGameMerge,
  foldFreedMember,
  listGameCharacters,
  mergeGameCharacters
} from './orchestrator-game-characters'
import type { GameHistoryRecord } from './orchestrator-game-history'

const freed = (patch: Partial<GameHistoryRecord> = {}): GameHistoryRecord => ({
  ticket: 'CIN-1',
  repo: 'cineco',
  branch: 'cin-1',
  agent: 'claude',
  account: null,
  launchedAt: '2026-11-11T10:00:00.000Z',
  endedAt: '2026-11-11T11:00:00.000Z',
  outcome: 'merged',
  pr: '#41 merged',
  lastReport: null,
  ...patch
})

const arthur = { key: 'arthur', name: 'Arthur' }
const merge = { ticket: 'CIN-1', number: 41, at: '2026-11-11T12:00:00.000Z' }
const xpOf = (stored: Record<string, unknown> | null): number | undefined =>
  listGameCharacters(stored ?? {})[0]?.xp

// Why (ORCA-1170): auto-release and a stop free a merged member without a merged outcome, so its XP stayed 0.
describe('creditGameMerge', () => {
  it('credits a merge to a character no free has written yet, and keeps its counts at zero', () => {
    const [character] = listGameCharacters(creditGameMerge({}, arthur, merge) ?? {})

    expect(character).toMatchObject({ key: 'arthur', name: 'Arthur', xp: 100, tickets: 0 })
    expect(character?.lastAt).toBe('2026-11-11T12:00:00.000Z')
  })

  it('credits one PR once, whichever of the merge and the free comes first', () => {
    const credited = creditGameMerge({}, arthur, merge)
    expect(creditGameMerge(credited ?? {}, arthur, merge)).toBeNull()
    const thenFreed = foldFreedMember(credited ?? {}, arthur, freed())
    expect(xpOf(thenFreed)).toBe(100)
    expect(listGameCharacters(thenFreed ?? {})[0]?.tickets).toBe(1)

    const freedFirst = foldFreedMember({}, arthur, freed())
    const thenMerged = creditGameMerge(freedFirst ?? {}, arthur, merge)
    expect(xpOf(thenMerged ?? freedFirst)).toBe(100)
  })

  it('does not credit again a merge an older build already folded as a merged free', () => {
    const older = foldFreedMember({}, arthur, freed())
    const { settled: _settled, ...withoutKeys } = (older?.arthur ?? {}) as Record<string, unknown>

    expect(xpOf(creditGameMerge({ arthur: withoutKeys }, arthur, merge))).toBe(100)
  })

  it('tops a QA handoff up to 100 on its merge, in either order', () => {
    const qa = foldFreedMember({}, arthur, freed({ outcome: 'qa', pr: '#41 open' }))
    expect(xpOf(qa)).toBe(50)
    expect(xpOf(creditGameMerge(qa ?? {}, arthur, merge))).toBe(100)

    const mergedFirst = creditGameMerge({}, arthur, merge)
    expect(xpOf(foldFreedMember(mergedFirst ?? {}, arthur, freed({ outcome: 'qa' })))).toBe(100)
  })

  it('credits another PR of the same ticket on its own', () => {
    const one = creditGameMerge({}, arthur, merge)

    expect(xpOf(creditGameMerge(one ?? {}, arthur, { ...merge, number: 42 }))).toBe(200)
  })

  it('keeps what was credited when another store is adopted', () => {
    const mine = creditGameMerge({}, arthur, merge) ?? {}
    const theirs = foldFreedMember({}, arthur, freed({ ticket: 'CIN-9', pr: null })) ?? {}
    const adopted = mergeGameCharacters(mine, theirs)

    expect(xpOf(adopted)).toBe(200)
    expect(creditGameMerge(adopted, arthur, merge)).toBeNull()
  })
})
