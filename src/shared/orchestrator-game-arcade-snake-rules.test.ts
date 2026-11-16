import { describe, expect, it } from 'vitest'
import {
  snakeFoodOf,
  snakeSpeedOf,
  snakeStartOf,
  snakeStepOf,
  snakeTurnOf,
  type SnakeGame,
  type SnakeState
} from './orchestrator-game-arcade-snake-rules'

const game: SnakeGame = {
  grid: { columns: 12, rows: 8 },
  speed: { start: 10, max: 12, rampPerFood: 1 },
  start: { length: 3 },
  food: { points: 10, growth: 2 }
}
// 10 cells per second: one cell every 100 ms.
const CELL_MS = 100

const at = (state: Partial<SnakeState>): SnakeState => ({ ...snakeStartOf(game, 1), ...state })
const cells = (state: SnakeState, n: number): SnakeState => {
  let next = state
  for (let i = 0; i < n; i += 1) {
    next = snakeStepOf(game, next, CELL_MS)
  }
  return next
}

describe('snakeStepOf', () => {
  it('starts mid-board heading right and moves one cell per cell of banked time', () => {
    const start = snakeStartOf(game, 1)
    expect(start.body).toEqual([
      { x: 6, y: 4 },
      { x: 5, y: 4 },
      { x: 4, y: 4 }
    ])
    const half = snakeStepOf(game, start, CELL_MS / 2)
    expect(half.body).toEqual(start.body)
    expect(snakeStepOf(game, half, CELL_MS / 2).body[0]).toEqual({ x: 7, y: 4 })
  })

  it('eats the food in its path, scores, grows by the file growth and places new food off its body', () => {
    const fed = cells(at({ food: { x: 7, y: 4 } }), 1)
    expect(fed).toMatchObject({ eaten: 1, score: 10, growth: 2 })
    expect(fed.food).not.toBeNull()
    expect(fed.body.some((one) => one.x === fed.food?.x && one.y === fed.food?.y)).toBe(false)
    expect(cells(fed, 2).body).toHaveLength(5)
    expect(cells(fed, 3).body).toHaveLength(5)
  })

  it('speeds up per food eaten until the max', () => {
    expect(snakeSpeedOf(game, 0)).toBe(10)
    expect(snakeSpeedOf(game, 1)).toBe(11)
    expect(snakeSpeedOf(game, 9)).toBe(12)
  })

  it('ends on the wall', () => {
    const atWall = at({
      body: [
        { x: 11, y: 4 },
        { x: 10, y: 4 },
        { x: 9, y: 4 }
      ],
      food: null
    })
    const crashed = cells({ ...atWall, food: { x: 0, y: 0 } }, 1)
    expect(crashed.isOver).toBe(true)
    expect(crashed.body[0]).toEqual({ x: 11, y: 4 })
    expect(snakeStepOf(game, crashed, CELL_MS)).toBe(crashed)
  })

  it('ends on its own tail, but may follow the tail into the cell it leaves', () => {
    // A 5-long snake curled in a square: turning down drives the head into its own body.
    const curled = at({
      body: [
        { x: 5, y: 4 },
        { x: 4, y: 4 },
        { x: 4, y: 5 },
        { x: 5, y: 5 },
        { x: 6, y: 5 }
      ],
      heading: 'left',
      food: { x: 0, y: 0 }
    })
    expect(cells(snakeTurnOf(curled, 'down'), 1).isOver).toBe(true)
    // Four long, the same square leaves the tail cell free as the head enters it.
    const chasing = at({ ...curled, body: curled.body.slice(0, 4), heading: 'up' })
    const followed = cells(snakeTurnOf(chasing, 'right'), 1)
    expect(followed.isOver).toBe(false)
    expect(followed.body[0]).toEqual({ x: 6, y: 4 })
  })

  it('ignores a turn back into its own neck and caps the queue at two turns', () => {
    const start = snakeStartOf(game, 1)
    expect(snakeTurnOf(start, 'left')).toBe(start)
    expect(snakeTurnOf(start, 'right')).toBe(start)
    const queued = snakeTurnOf(snakeTurnOf(snakeTurnOf(start, 'up'), 'left'), 'down')
    expect(queued.turns).toEqual(['up', 'left'])
    const cornered = cells(queued, 2)
    expect(cornered.body[0]).toEqual({ x: 5, y: 3 })
    expect(cornered.heading).toBe('left')
  })

  it('caps a late frame so a stalled host does not move the snake unseen', () => {
    expect(snakeStepOf(game, snakeStartOf(game, 1), 5_000).body[0]).toEqual({ x: 7, y: 4 })
  })
})

describe('snakeFoodOf', () => {
  it('is the same cell for the same seed and never on the body', () => {
    const body = snakeStartOf(game, 1).body
    expect(snakeFoodOf(game, body, 42, 3)).toEqual(snakeFoodOf(game, body, 42, 3))
    for (let eaten = 0; eaten < 50; eaten += 1) {
      const food = snakeFoodOf(game, body, 9, eaten)
      expect(body.some((one) => one.x === food?.x && one.y === food?.y)).toBe(false)
    }
  })

  it('is null on a full board, and filling the board ends the run', () => {
    const tiny: SnakeGame = { ...game, grid: { columns: 2, rows: 1 }, start: { length: 1 } }
    const full = [
      { x: 0, y: 0 },
      { x: 1, y: 0 }
    ]
    expect(snakeFoodOf(tiny, full, 1, 0)).toBeNull()
    const state: SnakeState = {
      ...snakeStartOf(tiny, 1),
      body: [{ x: 0, y: 0 }],
      // Why growing: the tail keeps its cell, so the head fills the last free one.
      growth: 1,
      food: { x: 1, y: 0 }
    }
    const won = snakeStepOf(tiny, state, CELL_MS)
    expect(won).toMatchObject({ isOver: true, food: null, score: 10 })
  })
})
