import { afterEach, describe, expect, it } from 'vitest'

import { parseGameState } from '../hooks/game-state'
import { setGameLocale } from '../hooks/game-strings'
import { fleetAdvisorSummaryOf, memberAdvisorTextOf } from '../hooks/member-advisor'
import type { GameMemberAdvisor } from '../types'

afterEach(() => setGameLocale('en'))

const stateWith = (agent: Record<string, unknown>) =>
  JSON.stringify({
    agents: [
      {
        paneKey: 'tab-1:m',
        displayName: 'CIN-5',
        agentType: 'claude',
        state: 'working',
        toolName: null,
        isLeader: false,
        isMember: true,
        ...agent
      }
    ]
  })

const SWITCHED: GameMemberAdvisor = {
  model: 'Sonnet 5.5',
  effort: 'high',
  pinned: { model: true, effort: false },
  previous: { model: 'Opus 5.5', effort: 'high' }
}

describe("a member's Jev on its card", () => {
  it('keeps what Orca says Jev has the member on, and drops a malformed one', () => {
    expect(parseGameState(stateWith({ advisor: SWITCHED }))?.agents[0]?.advisor).toEqual(SWITCHED)
    const odd = { model: 'Opus 5.5', effort: 3, pinned: 'yes', previous: 'x' }
    expect(parseGameState(stateWith({ advisor: odd }))?.agents[0]?.advisor).toEqual({
      model: 'Opus 5.5',
      effort: null,
      pinned: { model: false, effort: false }
    })
    for (const advisor of ['opus', { model: 7 }, null]) {
      expect(parseGameState(stateWith({ advisor }))?.agents[0]?.advisor).toBeUndefined()
    }
    expect(parseGameState(stateWith({}))?.agents[0]?.advisor).toBeUndefined()
  })

  it('names the model and effort, the latest switch and the pin when the card has room', () => {
    expect(memberAdvisorTextOf(SWITCHED, 80)).toBe(
      '◆ Jev Opus 5.5·high → Sonnet 5.5·high · model pinned'
    )
    expect(memberAdvisorTextOf({ ...SWITCHED, previous: undefined }, 80)).toBe(
      '◆ Jev Sonnet 5.5·high · model pinned'
    )
    expect(memberAdvisorTextOf({ ...SWITCHED, pinned: { model: false, effort: false } }, 80)).toBe(
      '◆ Jev Opus 5.5·high → Sonnet 5.5·high'
    )
  })

  it('drops the pin, then its name, then the switch, never the model it is on now', () => {
    expect(memberAdvisorTextOf(SWITCHED, 40)).toBe('◆ Jev Opus 5.5·high → Sonnet 5.5·high')
    expect(memberAdvisorTextOf(SWITCHED, 34)).toBe('◆ Opus 5.5·high → Sonnet 5.5·high')
    expect(memberAdvisorTextOf(SWITCHED, 32)).toBe('◆ Sonnet 5.5·high · model pinned')
    expect(memberAdvisorTextOf(SWITCHED, 20)).toBe('◆ Sonnet 5.5·high')
    expect(memberAdvisorTextOf(SWITCHED, 10)).toBe('◆ Sonnet …')
  })

  it('says nothing for a Jev that names neither a model nor an effort', () => {
    const quiet = { model: null, effort: null, pinned: { model: true, effort: true } }
    expect(memberAdvisorTextOf(quiet, 80)).toBeNull()
  })

  it('speaks the session language', () => {
    setGameLocale('es')
    expect(memberAdvisorTextOf({ ...SWITCHED, pinned: { model: true, effort: true } }, 80)).toBe(
      '◆ Jev Opus 5.5·high → Sonnet 5.5·high · modelo y esfuerzo fijados'
    )
    expect(fleetAdvisorSummaryOf([{ advisor: SWITCHED }])).toBe('◆ 1 con Sonnet 5.5')
  })

  it("sums up the members' models, the most used first", () => {
    const on = (model: string | null): { advisor?: GameMemberAdvisor } => ({
      advisor: { model, effort: 'high', pinned: { model: false, effort: false } }
    })
    expect(
      fleetAdvisorSummaryOf([on('Opus 5.5'), on('Sonnet 5.5'), {}, on('Sonnet 5.5'), on(null)])
    ).toBe('◆ 2 on Sonnet 5.5, 1 on Opus 5.5')
    expect(fleetAdvisorSummaryOf([{}, on(null)])).toBeNull()
  })
})
