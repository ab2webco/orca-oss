import { describe, expect, it } from 'vitest'
import {
  addGameDecision,
  GAME_DECISIONS_MAX,
  gameDecisionListOf,
  gameDecisionOf,
  parseGameDecision,
  type GameDecision
} from './orchestrator-game-decisions'

const row = (n: number, followUp = false): GameDecision =>
  gameDecisionOf(
    { decision: `decision ${n}`, ticket: n % 2 === 0 ? 'orca-2' : 'ORCA-1', followUp },
    { id: `dec_${n}`, at: `2026-11-25T10:00:${String(n % 60).padStart(2, '0')}.000Z` }
  )

describe('game decision trail rows', () => {
  it('drops the oldest settled rows past the cap, never a pending follow-up', () => {
    let list: unknown[] = [row(0, true)]
    for (let n = 1; n <= GAME_DECISIONS_MAX + 2; n++) {
      list = addGameDecision(list, row(n))
    }

    expect(list).toHaveLength(GAME_DECISIONS_MAX)
    const ids = list.map((one) => parseGameDecision(one)?.id)
    expect(ids[0]).toBe('dec_0')
    expect(ids).not.toContain('dec_1')
    expect(ids).not.toContain('dec_3')
    expect(ids.at(-1)).toBe(`dec_${GAME_DECISIONS_MAX + 2}`)
  })

  it('reads a row with its optional fields missing, and skips one it cannot read', () => {
    expect(parseGameDecision({ id: 'dec_1', at: 't', decision: 'Ship it' })).toEqual({
      id: 'dec_1',
      at: 't',
      ticket: null,
      decision: 'Ship it',
      why: null,
      evidence: null,
      followUp: null
    })
    expect(parseGameDecision({ id: 'dec_1', at: 't', decision: 7 })).toBeNull()
    expect(parseGameDecision({ id: 'dec_1', at: 't', decision: 'x', followUp: 'open' })).toBeNull()
  })

  it('lists pending follow-ups oldest first and the latest 20 decisions newest first, by ticket', () => {
    const list = [row(1, true), ...Array.from({ length: 25 }, (_, i) => row(i + 2)), row(30, true)]

    const all = gameDecisionListOf(list)
    expect(all.followUps.map((one) => one.id)).toEqual(['dec_1', 'dec_30'])
    expect(all.decisions).toHaveLength(20)
    expect(all.decisions[0].id).toBe('dec_26')
    expect(all.total).toBe(25)
    expect(gameDecisionListOf(list, { all: true }).decisions).toHaveLength(25)

    const byTicket = gameDecisionListOf(list, { ticket: 'orca-2' })
    expect(byTicket.followUps.map((one) => one.id)).toEqual(['dec_30'])
    expect(byTicket.decisions.every((one) => one.ticket === 'ORCA-2')).toBe(true)
  })
})
