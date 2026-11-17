import { describe, expect, it } from 'vitest'
import { creditGameMerge } from './orchestrator-game-characters'
import {
  awardGameTeamXp,
  gameXpKeyOf,
  teamXpOf,
  type GameXpReward
} from './orchestrator-game-team-xp'

const claim: GameXpReward = {
  id: 'member-claimed:wt-12',
  kind: 'member-claimed',
  xp: 10,
  label: 'Merlín took ORCA-12'
}
const ciGreen: GameXpReward = {
  id: 'ci-green:github#41@wt-12',
  kind: 'ci-green',
  xp: 20,
  label: 'ORCA-12 · #41 CI green'
}
const merge: GameXpReward = {
  id: 'review-merged:github#41@wt-12',
  kind: 'review-merged',
  xp: 100,
  label: 'ORCA-12 · #41 merged'
}

/** Awards one reward on top of `raw` and returns the stored rows and the new total. */
function step(raw: unknown, characters: Record<string, unknown>, reward: GameXpReward) {
  const { next } = awardGameTeamXp(raw, characters, [reward], 1)
  return { raw: next ?? raw, total: teamXpOf(next ?? raw, characters).total }
}

describe('team XP', () => {
  it('moves the total by each toasted reward: a claim, a CI green and a merge', () => {
    const characters = {}
    const start = teamXpOf(undefined, characters).total
    const claimed = step(undefined, characters, claim)
    expect(claimed.total - start).toBe(10)
    const green = step(claimed.raw, characters, ciGreen)
    expect(green.total - claimed.total).toBe(20)
    const merged = step(green.raw, characters, merge)
    expect(merged.total - green.total).toBe(100)
  })

  it('counts the characters XP an older host already showed, so the level never drops', () => {
    const characters = creditGameMerge(
      {},
      { key: 'merlin', name: 'Merlín' },
      { ticket: 'ORCA-9', number: 9, at: '2026-11-17T10:00:00.000Z' }
    )!
    expect(teamXpOf(undefined, characters).total).toBe(100)
  })

  it('pays a merge once when the host paid its character and the mod toasted it, at the toast XP', () => {
    const paid = creditGameMerge(
      {},
      { key: 'merlin', name: 'Merlín' },
      { ticket: 'ORCA-12', number: 41, at: '2026-11-17T10:00:00.000Z' }
    )!
    expect(teamXpOf(undefined, paid).total).toBe(100)
    const weighted = { ...merge, xp: 150 }
    expect(step(undefined, paid, weighted).total).toBe(150)
    // The award first, the character's pay after: still 150, not 250.
    const early = step(undefined, {}, weighted)
    expect(early.total).toBe(150)
    expect(teamXpOf(early.raw, paid).total).toBe(150)
  })

  it('counts one PR once whichever pane saw it', () => {
    const lead = step(undefined, {}, ciGreen)
    const member = awardGameTeamXp(lead.raw, {}, [{ ...ciGreen, id: 'ci-green:github#41@wt-9' }], 2)
    expect(member.next).toBeNull()
    expect(gameXpKeyOf('perfect-merge:gitlab!7@wt')).toBe('perfect-merge:!7')
    expect(gameXpKeyOf('work-item-done:plane:ORCA-12')).toBe('work-item-done:plane:ORCA-12')
  })

  it('keeps the total when the oldest rows fold past the cap, and lists the newest first', () => {
    let raw: unknown
    for (let i = 0; i < 1005; i += 1) {
      raw = awardGameTeamXp(raw, {}, [{ ...claim, id: `member-claimed:wt-${i}` }], i).next
    }
    const team = teamXpOf(raw, {})
    expect(team.total).toBe(10_050)
    expect(team.recent[0]?.id).toBe('member-claimed:wt-1004')
    expect((raw as { awards: unknown[] }).awards).toHaveLength(1000)
  })

  it('skips rows this build cannot read', () => {
    const raw = {
      folded: 'x',
      awards: [{ id: 'a', kind: 'future-kind', xp: 5, label: '', at: 1 }, { id: 'b' }]
    }
    expect(teamXpOf(raw, {})).toEqual({ total: 0, recent: [] })
  })
})
