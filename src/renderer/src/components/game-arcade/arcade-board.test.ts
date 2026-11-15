import { describe, expect, it } from 'vitest'
import { ORCHESTRATOR_GAME_ARCADE_SNAKE } from '../../../../shared/orchestrator-game-arcade-file'
import { snakeStartOf } from '../../../../shared/orchestrator-game-arcade-snake-rules'
import { arcadeBoardOf } from './arcade-board'
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
