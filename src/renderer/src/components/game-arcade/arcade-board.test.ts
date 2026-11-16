import { describe, expect, it } from 'vitest'
import { ORCHESTRATOR_GAME_ARCADE_SNAKE } from '../../../../shared/orchestrator-game-arcade-file'
import { snakeStartOf } from '../../../../shared/orchestrator-game-arcade-snake-rules'
import { arcadeBoardOf, arcadeGridFitOf } from './arcade-board'
import { SNAKE_DRIVER } from './arcade-driver-snake'
import { snakeTapTurnOf } from './arcade-snake-paint'

const game = JSON.parse(ORCHESTRATOR_GAME_ARCADE_SNAKE)
const state = snakeStartOf(game, 1)
const grid = game.grid

describe('arcadeBoardOf', () => {
  it.each([
    [1440, 820],
    [768, 700],
    [390, 640],
    [320, 560]
  ])('keeps the whole field inside a %i x %i tab, below the score lines', (width, height) => {
    const board = arcadeBoardOf({ width, height }, grid)
    expect(board.left).toBeGreaterThanOrEqual(0)
    expect(board.left + board.cell * grid.columns).toBeLessThanOrEqual(width)
    expect(board.top).toBeGreaterThanOrEqual(56)
    expect(board.top + board.cell * grid.rows).toBeLessThanOrEqual(height)
  })
})

describe('arcadeGridFitOf', () => {
  // The Arcade column at 768 with both side panels open.
  const column = { width: 176, height: 1080 }

  it('turns a wide grid in a tall tab, so a narrow column gets cells, not dots', () => {
    const turned = arcadeGridFitOf(column, grid)
    expect(turned).toEqual({ columns: grid.rows, rows: grid.columns })
    expect(arcadeBoardOf(column, turned).cell).toBeGreaterThanOrEqual(10)
    expect(arcadeBoardOf(column, grid).cell).toBeLessThan(7)
  })

  it('keeps the grid in a wide tab, and turns a tall grid back in one', () => {
    expect(arcadeGridFitOf({ width: 900, height: 600 }, grid)).toBe(grid)
    expect(arcadeGridFitOf({ width: 900, height: 600 }, { columns: 15, rows: 24 })).toEqual({
      columns: 24,
      rows: 15
    })
  })

  it('lays the snake out tall in a tall tab, starting it inside the turned grid', () => {
    const tall = SNAKE_DRIVER.fitOf!(game, column)
    expect(tall.grid).toEqual({ columns: 15, rows: 24 })
    const start = snakeStartOf(tall, 1)
    for (const cell of start.body) {
      expect(cell.x).toBeLessThan(15)
      expect(cell.y).toBeLessThan(24)
    }
  })
})

describe('snakeTapTurnOf', () => {
  it('steers toward the tap from the head, on the farther axis', () => {
    const size = { width: 768, height: 700 }
    const board = arcadeBoardOf(size, grid)
    const head = state.body[0]!
    const headX = board.left + (head.x + 0.5) * board.cell
    const headY = board.top + (head.y + 0.5) * board.cell
    expect(snakeTapTurnOf(game, state, size, headX, headY - 100)).toBe('up')
    expect(snakeTapTurnOf(game, state, size, headX - 10, headY + 100)).toBe('down')
    expect(snakeTapTurnOf(game, state, size, headX - 200, headY + 10)).toBe('left')
  })
})
