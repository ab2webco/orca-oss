import { afterEach, describe, expect, it } from 'vitest'

import { parseGameState } from '../hooks/game-state'
import { setGameLocale } from '../hooks/game-strings'
import {
  fleetAdvisorSummaryOf,
  memberAdvisorLinesOf,
  memberModelLinesOf,
  memberModelOf
} from '../hooks/member-advisor'
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

  it('keeps the model and effort Orca launched the member on, and drops a malformed one', () => {
    const launch = { model: 'Opus 5.5', effort: 'high' }
    expect(parseGameState(stateWith({ launch }))?.agents[0]?.launch).toEqual(launch)
    expect(parseGameState(stateWith({ launch: { model: 'Opus 5.5' } }))?.agents[0]?.launch).toEqual(
      { model: 'Opus 5.5', effort: null }
    )
    for (const odd of ['opus', { model: 7 }, { model: null, effort: null }, null]) {
      expect(parseGameState(stateWith({ launch: odd }))?.agents[0]?.launch).toBeUndefined()
    }
  })

  it("names the launch model where the member's Jev reports none, and Jev's where it does", () => {
    const launch = { model: 'Opus 5.5', effort: 'high' }
    expect(memberModelLinesOf({ launch }, 80)).toEqual(['◇ Opus 5.5·high'])
    expect(memberModelLinesOf({ launch, advisor: SWITCHED }, 80)).toEqual([
      '◆ Jev Sonnet 5.5·high · model pinned',
      '↳ Opus 5.5 → Sonnet 5.5'
    ])
    expect(memberModelLinesOf({}, 80)).toEqual([])
    expect(memberModelOf({ launch })).toBe('Opus 5.5·high')
    expect(memberModelOf({ launch, advisor: SWITCHED })).toBe('Sonnet 5.5·high')
    expect(memberModelOf({})).toBeNull()
  })

  it('sums up the fleet from the launch model where no Jev reports', () => {
    expect(
      fleetAdvisorSummaryOf([
        { launch: { model: 'Opus 5.5', effort: 'high' } },
        { launch: { model: 'Opus 5.5', effort: 'high' } },
        { advisor: SWITCHED, launch: { model: 'Opus 5.5', effort: 'high' } }
      ])
    ).toBe('◆ 2 on Opus 5.5, 1 on Sonnet 5.5')
  })

  it('names the model, the effort and the pin, then the latest switch on its own line', () => {
    expect(memberAdvisorLinesOf(SWITCHED, 80)).toEqual([
      '◆ Jev Sonnet 5.5·high · model pinned',
      '↳ Opus 5.5 → Sonnet 5.5'
    ])
    expect(memberAdvisorLinesOf({ ...SWITCHED, previous: undefined }, 80)).toEqual([
      '◆ Jev Sonnet 5.5·high · model pinned'
    ])
    expect(
      memberAdvisorLinesOf({ ...SWITCHED, pinned: { model: false, effort: false } }, 80)
    ).toEqual(['◆ Jev Sonnet 5.5·high', '↳ Opus 5.5 → Sonnet 5.5'])
  })

  it('a switch names only what changed', () => {
    const effort = { ...SWITCHED, effort: 'low', previous: { model: 'Sonnet 5.5', effort: 'high' } }
    expect(memberAdvisorLinesOf(effort, 80)[1]).toBe('↳ high → low')
    const both = { ...SWITCHED, previous: { model: 'Opus 5.5', effort: 'max' } }
    expect(memberAdvisorLinesOf(both, 80)[1]).toBe('↳ Opus 5.5·max → Sonnet 5.5·high')
    const same = { ...SWITCHED, previous: { model: 'Sonnet 5.5', effort: 'high' } }
    expect(memberAdvisorLinesOf(same, 80)).toHaveLength(1)
  })

  it('drops Jev’s name, then the pin, never the model it is on now', () => {
    expect(memberAdvisorLinesOf(SWITCHED, 34)[0]).toBe('◆ Sonnet 5.5·high · model pinned')
    expect(memberAdvisorLinesOf(SWITCHED, 20)).toEqual([
      '◆ Sonnet 5.5·high',
      '↳ Opus 5.5 → Sonnet…'
    ])
    expect(memberAdvisorLinesOf(SWITCHED, 10)).toEqual(['◆ Sonnet …', '↳ Opus 5.…'])
  })

  it('says nothing for a Jev that names neither a model nor an effort', () => {
    const quiet = { model: null, effort: null, pinned: { model: true, effort: true } }
    expect(memberAdvisorLinesOf(quiet, 80)).toEqual([])
  })

  it('speaks the session language', () => {
    setGameLocale('es')
    expect(
      memberAdvisorLinesOf({ ...SWITCHED, pinned: { model: true, effort: true } }, 80)[0]
    ).toBe('◆ Jev Sonnet 5.5·high · modelo y esfuerzo fijados')
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
