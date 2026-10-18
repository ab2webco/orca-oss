import { describe, expect, it } from 'vitest'
import {
  ORCHESTRATOR_GAME_BUILT_IN_ROSTERS,
  memberDisplayNameOf,
  memberNameOf,
  memberRosterIssues,
  memberRosterOf,
  nextMemberName
} from './orchestrator-game-member-names'
import { ORCHESTRATOR_GAME_BUILT_IN_SCENES } from './orchestrator-game-config'

const ROSTER = [{ en: 'Arthur', es: 'Arturo' }, 'Merlin', 'Lancelot']

describe('nextMemberName', () => {
  it('takes the first name no live member holds', () => {
    expect(nextMemberName(ROSTER, [], 'en')).toBe('Arthur')
    expect(nextMemberName(ROSTER, ['Arthur'], 'en')).toBe('Merlin')
  })

  it("names in the UI language and treats any language's variant as taken", () => {
    expect(nextMemberName(ROSTER, [], 'es')).toBe('Arturo')
    expect(nextMemberName(ROSTER, ['Arthur'], 'es')).toBe('Merlin')
    expect(nextMemberName(ROSTER, [], 'fr')).toBe('Arthur')
  })

  it('frees a name once its member is gone, and falls back to none when all are taken', () => {
    expect(nextMemberName(ROSTER, ['Merlin', 'Lancelot'], 'en')).toBe('Arthur')
    expect(nextMemberName(ROSTER, ['Arthur', 'Merlin', 'Lancelot'], 'en')).toBeNull()
    expect(nextMemberName([], [], 'en')).toBeNull()
  })
})

describe('member display name', () => {
  it('puts the character before the ticket so a length cut lands on the title', () => {
    expect(memberDisplayNameOf('Merlin', 'CIN-12 Cartelera page', 60)).toBe(
      'Merlin · CIN-12 Cartelera page'
    )
    expect(memberDisplayNameOf('Merlin', 'CIN-12 A very long title', 20)).toBe(
      'Merlin · CIN-12 A ve'
    )
    expect(memberDisplayNameOf(null, 'CIN-12 Cartelera page', 60)).toBe('CIN-12 Cartelera page')
  })

  it('never cuts into the ticket for a long name', () => {
    const name = 'N'.repeat(32)
    expect(memberDisplayNameOf(name, 'CIN-12 Cartelera', 40, 'CIN-12')).toBe(`${name} · CIN-12`)
  })

  it('reads the character back only when a ticket follows it', () => {
    expect(memberNameOf('Merlin · CIN-12 Cartelera page')).toBe('Merlin')
    expect(memberNameOf('CIN-12 Cartelera page')).toBeNull()
    expect(memberNameOf('CIN-12 Fix a · b split')).toBeNull()
  })
})

describe('memberRosterOf', () => {
  it('ships a roster for every built-in scene', () => {
    for (const scene of ORCHESTRATOR_GAME_BUILT_IN_SCENES) {
      expect(ORCHESTRATOR_GAME_BUILT_IN_ROSTERS[scene].length).toBeGreaterThanOrEqual(12)
      expect(memberRosterIssues(ORCHESTRATOR_GAME_BUILT_IN_ROSTERS[scene])).toEqual([])
    }
  })

  it('uses the active scene: a built-in, a plugin or scene-file roster, else Quest', () => {
    const custom = { id: 'me/mario', pluginId: 'me', definition: { roster: ['Mario', 'Luigi'] } }
    expect(memberRosterOf({ config: { scene: 'jrpg' } })).toBe(
      ORCHESTRATOR_GAME_BUILT_IN_ROSTERS.jrpg
    )
    expect(
      memberRosterOf({ config: { scene: 'me/mario' }, extensions: { scenes: [custom] } })
    ).toEqual(['Mario', 'Luigi'])
    expect(memberRosterOf({ config: {} })).toBe(ORCHESTRATOR_GAME_BUILT_IN_ROSTERS.quest)
  })

  it('gives no names for a custom scene without a roster', () => {
    const bare = { id: 'me/bare', pluginId: 'me', definition: {} }
    expect(
      memberRosterOf({ config: { scene: 'me/bare' }, extensions: { scenes: [bare] } })
    ).toEqual([])
  })
})

describe('memberRosterIssues', () => {
  it('refuses a name that reads as a ticket, carries the separator, or repeats', () => {
    expect(memberRosterIssues(['K-9'])).toEqual(['0: must not look like a ticket id'])
    expect(memberRosterIssues(['A · B'])).toEqual(['0: must not contain " · "'])
    expect(memberRosterIssues(['Ann', { en: 'Ann' }])).toEqual(['1: "Ann" is listed twice'])
    expect(memberRosterIssues(['bad\u0007'])).toEqual(['0: must not contain control characters'])
  })
})
