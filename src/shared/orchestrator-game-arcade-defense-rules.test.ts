import { describe, expect, it } from 'vitest'
import {
  defenseAimOf,
  defenseFallSpeedOf,
  defenseFireOf,
  defenseMergeLineOf,
  defenseMoveOf,
  defenseStartOf,
  defenseStepOf,
  defenseWaveOf,
  type DefenseGame,
  type DefenseState
} from './orchestrator-game-arcade-defense-rules'

const game: DefenseGame = {
  field: { columns: 20, rows: 16 },
  turret: { speed: 20, cooldownMs: 300 },
  shot: { speed: 30 },
  enemies: {
    start: 3,
    max: 6,
    rampPerWave: 1,
    spawnMs: 1000,
    spawnMinMs: 400,
    perWave: 4,
    buildShare: 0.5
  },
  lives: 2,
  points: { bug: 10, build: 25 }
}
const at = (state: Partial<DefenseState>): DefenseState => ({
  ...defenseStartOf(game, 1),
  // Why far off: these cases place their own enemies and must not meet a spawned one.
  spawnAt: 1e9,
  ...state
})
const run = (state: DefenseState, ms: number): DefenseState => {
  let next = state
  for (let t = 0; t < ms; t += 50) {
    next = defenseStepOf(game, next, 50)
  }
  return next
}

describe('defenseStepOf', () => {
  it('starts mid-field with every life and no enemy yet', () => {
    const start = defenseStartOf(game, 1)
    expect(start).toMatchObject({ turret: 10, lives: 2, score: 0, isOver: false })
    expect(start.enemies).toEqual([])
    // The first frame already brings a bug into the field, so a start key shows the run moving.
    const first = defenseStepOf(game, start, 50)
    expect(first.enemies).toHaveLength(1)
    expect(first.enemies[0]!.y).toBeGreaterThan(0)
  })

  it('fires a shot up from the turret that kills a bug above it and scores', () => {
    const fired = defenseFireOf(at({ enemies: [{ x: 10, y: 4, kind: 'bug', hp: 1 }] }))
    const hit = run(fired, 600)
    expect(hit.enemies).toEqual([])
    expect(hit).toMatchObject({ kills: 1, score: 10 })
  })

  it('needs two hits on a red build', () => {
    const build = at({ enemies: [{ x: 10, y: 2, kind: 'build', hp: 2 }] })
    const once = run(defenseFireOf(build), 350)
    expect(once.enemies).toHaveLength(1)
    expect(once.enemies[0]!.hp).toBe(1)
    const twice = run(defenseFireOf(once), 400)
    expect(twice).toMatchObject({ kills: 1, score: 25 })
  })

  it('waits out the cooldown before a second shot', () => {
    const first = defenseStepOf(game, defenseFireOf(at({})), 50)
    expect(first.shots).toHaveLength(1)
    const tooSoon = defenseStepOf(game, defenseFireOf(first), 50)
    expect(tooSoon.shots).toHaveLength(1)
    const later = defenseStepOf(game, defenseFireOf(run(tooSoon, 300)), 50)
    expect(later.shots.length).toBeGreaterThan(0)
    expect(later.readyAt).toBeGreaterThan(tooSoon.readyAt)
  })

  it('costs a life for a bug that reaches the merge line, and ends with the last one', () => {
    const line = defenseMergeLineOf(game)
    const landing = at({ enemies: [{ x: 3, y: line - 0.1, kind: 'bug', hp: 1 }] })
    const once = run(landing, 100)
    expect(once).toMatchObject({ lives: 1, isOver: false })
    const twice = run({ ...once, enemies: [{ x: 3, y: line - 0.1, kind: 'bug', hp: 1 }] }, 100)
    expect(twice).toMatchObject({ lives: 0, isOver: true })
    expect(defenseStepOf(game, twice, 50)).toBe(twice)
  })

  it('speeds the fall up by wave, to the max', () => {
    expect(defenseWaveOf(game, 0)).toBe(1)
    expect(defenseWaveOf(game, 4)).toBe(2)
    expect(defenseFallSpeedOf(game, 1)).toBe(3)
    expect(defenseFallSpeedOf(game, 2)).toBe(4)
    expect(defenseFallSpeedOf(game, 9)).toBe(6)
  })

  it('moves the turret with held keys and toward a pointer, within the field', () => {
    expect(run(defenseMoveOf(at({}), -1), 2000).turret).toBe(0.5)
    expect(run(defenseAimOf(at({}), 15), 1000).turret).toBeCloseTo(15)
  })

  it('spawns only bugs in the first wave, and the same run for the same seed', () => {
    const first = run(defenseStartOf(game, 7), 3000)
    expect(first.enemies.every((one) => one.kind === 'bug')).toBe(true)
    expect(run(defenseStartOf(game, 7), 3000)).toEqual(first)
  })

  it('keeps a fast shot from passing through an enemy in one long frame', () => {
    const fast = { ...game, shot: { speed: 60 } }
    const state = {
      ...defenseStartOf(fast, 1),
      spawnAt: 1e9,
      shots: [{ x: 5, y: 9 }],
      enemies: [{ x: 5, y: 5, kind: 'bug' as const, hp: 1 }]
    }
    expect(defenseStepOf(fast, state, 100).kills).toBe(1)
  })
})
