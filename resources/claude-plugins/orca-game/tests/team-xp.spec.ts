import { describe, expect, it } from 'vitest'

import { gameXpArgvOf } from '../hooks/game-config'
import { gameStateOf } from '../hooks/game-state'
import { hostTeamXpOf, teamXpOf } from '../hooks/rewards'

// ORCA-1264: the score line and the panel's level bar show the host's one team total.
describe('team XP from the host', () => {
  it('reads the total game state carries, and none from an older host', () => {
    expect(teamXpOf({ total: 1530, recent: [] })).toEqual({ teamXp: { total: 1530 } })
    expect(teamXpOf(undefined)).toEqual({})
    expect(teamXpOf({ total: 'lots' })).toEqual({})
    const base = { config: {}, warnings: [], agents: [], worktree: null }
    expect(gameStateOf({ ...base, teamXp: { total: 70 } })?.teamXp).toEqual({ total: 70 })
    expect(gameStateOf(base)?.teamXp).toBeUndefined()
  })

  it("reads `orca game xp --json`'s total, and nothing from a reply it cannot read", () => {
    const reply = { id: '1', ok: true, result: { added: 1, teamXp: { total: 1630, recent: [] } } }
    expect(hostTeamXpOf(JSON.stringify(reply))).toBe(1630)
    expect(hostTeamXpOf('Team XP: 1630')).toBeUndefined()
    expect(hostTeamXpOf(JSON.stringify({ ok: true, result: {} }))).toBeUndefined()
  })

  it('reports each toasted reward within the bounds the host accepts', () => {
    const argv = gameXpArgvOf('/bin/orca', [
      { id: 'ci-green:github#4@wt', kind: 'ci-green', xp: 20, label: 'x'.repeat(300) },
      { id: 'y'.repeat(401), kind: 'ci-green', xp: 20, label: 'cut' }
    ])
    expect(argv?.slice(0, 4)).toEqual(['/bin/orca', 'game', 'xp', '--rewards'])
    expect(JSON.parse(argv?.[4] ?? '')).toEqual([
      { id: 'ci-green:github#4@wt', kind: 'ci-green', xp: 20, label: 'x'.repeat(200) }
    ])
    expect(gameXpArgvOf(undefined, [])).toBeUndefined()
  })
})
