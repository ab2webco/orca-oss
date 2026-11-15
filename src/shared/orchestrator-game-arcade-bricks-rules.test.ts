import { describe, expect, it } from 'vitest'
import {
  BRICKS_WALL_TOP,
  bricksAimOf,
  bricksBallSpeedOf,
  bricksMoveOf,
  bricksPaddleTopOf,
  bricksPaddleWidthOf,
  bricksStartOf,
  bricksStepOf,
  type BricksGame,
  type BricksState
} from './orchestrator-game-arcade-bricks-rules'

const game: BricksGame = {
  field: { columns: 20, rows: 16 },
  wall: { columns: 4, rows: 2, points: 5 },
  paddle: { width: 4, speed: 20 },
  ball: { start: 10, max: 14, rampPerWall: 2 },
  powerUps: { chance: 0, wideMs: 5000 }
}
const at = (state: Partial<BricksState>): BricksState => ({ ...bricksStartOf(game, 1), ...state })
const run = (state: BricksState, ms: number): BricksState => {
  let next = state
  for (let t = 0; t < ms; t += 50) {
    next = bricksStepOf(game, next, 50)
  }
  return next
}

describe('bricksStepOf', () => {
  it('serves one ball upward off the paddle under a full wall', () => {
    const start = bricksStartOf(game, 1)
    expect(start.bricks.every(Boolean)).toBe(true)
    expect(start.balls).toHaveLength(1)
    expect(start.balls[0]!.vy).toBeLessThan(0)
    expect(Math.hypot(start.balls[0]!.vx, start.balls[0]!.vy)).toBeCloseTo(10)
  })

  it('breaks the brick it hits, scores it and bounces back down', () => {
    // Straight up into the bottom row's second brick (columns 5..10, row 3).
    const ball = { x: 7.5, y: BRICKS_WALL_TOP + 2.6, vx: 0, vy: -10 }
    const hit = run(at({ balls: [ball] }), 100)
    expect(hit.bricks.filter((alive) => !alive)).toHaveLength(1)
    expect(hit.bricks[1 * 4 + 1]).toBe(false)
    expect(hit.score).toBe(5)
    expect(hit.balls[0]!.vy).toBeGreaterThan(0)
  })

  it('bounces off the side walls and the ceiling', () => {
    const side = run(at({ balls: [{ x: 19.7, y: 12, vx: 10, vy: 0.01 }] }), 100)
    expect(side.balls[0]!.vx).toBeLessThan(0)
    const empty = at({ bricks: at({}).bricks.map(() => false) })
    const ceiling = bricksStepOf(game, { ...empty, bricks: [true, ...empty.bricks.slice(1)] }, 0)
    const up = run({ ...ceiling, balls: [{ x: 19, y: 0.6, vx: 0, vy: -10 }] }, 100)
    expect(up.balls[0]!.vy).toBeGreaterThan(0)
  })

  it('sends the ball back up off the paddle, angled by where it lands', () => {
    const top = bricksPaddleTopOf(game)
    const edge = run(at({ balls: [{ x: 11.8, y: top - 1, vx: 0, vy: 10 }] }), 150)
    expect(edge.balls[0]!.vy).toBeLessThan(0)
    expect(edge.balls[0]!.vx).toBeGreaterThan(0)
    const left = run(at({ balls: [{ x: 8.2, y: top - 1, vx: 0, vy: 10 }] }), 150)
    expect(left.balls[0]!.vx).toBeLessThan(0)
  })

  it('ends when the last ball falls past the paddle', () => {
    const lost = run(at({ balls: [{ x: 2, y: 14, vx: 0, vy: 10 }] }), 500)
    expect(lost.isOver).toBe(true)
    expect(bricksStepOf(game, lost, 50)).toBe(lost)
  })

  it('brings a faster, full wall once the last brick breaks', () => {
    const last = at({
      bricks: [true, false, false, false, false, false, false, false],
      balls: [{ x: 2.5, y: BRICKS_WALL_TOP + 1.6, vx: 0, vy: -10 }]
    })
    const next = run(last, 100)
    expect(next.wall).toBe(2)
    expect(next.bricks.every(Boolean)).toBe(true)
    expect(Math.hypot(next.balls[0]!.vx, next.balls[0]!.vy)).toBeCloseTo(bricksBallSpeedOf(game, 2))
  })

  it('moves the paddle with held keys and toward a pointer, never past the field', () => {
    const left = run(bricksMoveOf(at({}), -1), 2000)
    expect(left.paddle).toBe(2)
    const aimed = run(bricksAimOf(at({}), 14), 1000)
    expect(aimed.paddle).toBeCloseTo(14)
    expect(bricksMoveOf(aimed, 1).target).toBeNull()
  })

  it('catches drops: three balls, or a wide paddle for a while', () => {
    const top = bricksPaddleTopOf(game)
    const paddleBall = { x: 3, y: 4, vx: 0, vy: 10 }
    const multi = run(
      at({ balls: [paddleBall], drops: [{ x: 10, y: top - 0.2, kind: 'multi' }] }),
      100
    )
    expect(multi.balls).toHaveLength(3)
    const wide = run(
      at({ balls: [paddleBall], drops: [{ x: 10, y: top - 0.2, kind: 'wide' }] }),
      100
    )
    expect(bricksPaddleWidthOf(game, wide)).toBeGreaterThan(game.paddle.width)
    expect(bricksPaddleWidthOf(game, { ...wide, ms: wide.wideUntil })).toBe(game.paddle.width)
  })

  it('drops power-ups from broken bricks at the file chance, the same for the same seed', () => {
    const always = { ...game, powerUps: { chance: 0.5, wideMs: 5000 } }
    const broken = (seed: number) => {
      let state = { ...bricksStartOf(always, seed) }
      for (let i = 0; i < 400 && !state.isOver; i += 1) {
        state = bricksStepOf(always, { ...state, paddle: state.balls[0]?.x ?? state.paddle }, 50)
      }
      return state
    }
    expect(broken(3).broken).toBeGreaterThan(0)
    expect(broken(3)).toEqual(broken(3))
  })

  it('keeps a fast ball from passing through a brick in one long frame', () => {
    const fast = { ...game, ball: { start: 30, max: 30, rampPerWall: 0 } }
    const state = { ...bricksStartOf(fast, 1), balls: [{ x: 7.5, y: 4.5, vx: 0, vy: -30 }] }
    const hit = bricksStepOf(fast, state, 100)
    expect(hit.bricks.filter((alive) => !alive)).toHaveLength(1)
    // 3 units in one frame from just under the wall would end above it without substeps.
    expect(hit.balls[0]!.vy).toBeGreaterThan(0)
  })
})
