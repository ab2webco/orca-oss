import { describe, expect, it } from 'vitest'
import { ORCHESTRATOR_GAME_ARCADE_BRICKS } from '../../../../shared/orchestrator-game-arcade-file'
import { bricksStartOf } from '../../../../shared/orchestrator-game-arcade-bricks-rules'
import { arcadeBoardOf } from './arcade-board'
import { BRICKS_DRIVER, bricksFitOf } from './arcade-driver-bricks'

const game = JSON.parse(ORCHESTRATOR_GAME_ARCADE_BRICKS)
const view = { width: 800, height: 600 }
const start = bricksStartOf(game, 1)
const key = (code: string, isDown: boolean) => ({ kind: 'key' as const, code, isDown })

describe('BRICKS_DRIVER', () => {
  it('holds the paddle on an arrow or A/D until that key is let go', () => {
    const left = BRICKS_DRIVER.inputOf(game, start, key('ArrowLeft', true), view)
    expect(left?.move).toBe(-1)
    const bothRight = BRICKS_DRIVER.inputOf(game, left!, key('KeyD', true), view)
    expect(bothRight?.move).toBe(1)
    // Letting go of the arrow no longer held keeps the paddle on the key still down.
    expect(BRICKS_DRIVER.inputOf(game, bothRight!, key('ArrowLeft', false), view)?.move).toBe(1)
    expect(BRICKS_DRIVER.inputOf(game, bothRight!, key('KeyD', false), view)?.move).toBe(0)
    expect(BRICKS_DRIVER.inputOf(game, start, key('KeyQ', true), view)).toBeNull()
  })

  it('aims the paddle at the field column under the pointer', () => {
    const board = arcadeBoardOf(view, game.field)
    const x = board.left + 7.5 * board.cell
    const aimed = BRICKS_DRIVER.inputOf(
      game,
      start,
      { kind: 'pointer', x, y: 300, isPress: false },
      view
    )
    expect(aimed?.target).toBeCloseTo(7.5)
  })
})

describe('bricksFitOf', () => {
  // The Arcade column at 768 with both side panels open.
  const TALL = { width: 176, height: 1080 }

  it('plays the portrait field in a tall tab, so its bricks are not dots', () => {
    const laid = bricksFitOf(game, TALL)
    expect(laid.field).toEqual({ columns: 15, rows: 24 })
    expect(laid.wall).toEqual({ columns: 5, rows: 5, points: 5 })
    expect(laid.paddle).toEqual({ width: 4, speed: 26 })
    expect(arcadeBoardOf(TALL, game.field).cell).toBeLessThan(6)
    expect(arcadeBoardOf(TALL, laid.field).cell).toBeGreaterThanOrEqual(10)
    expect(bricksStartOf(laid, 1).bricks).toHaveLength(25)
  })

  it('keeps the file as is in a wide tab, or when the file has no portrait field', () => {
    expect(bricksFitOf(game, view)).toBe(game)
    const { portrait: _portrait, ...wideOnly } = game
    expect(bricksFitOf(wideOnly, TALL)).toBe(wideOnly)
  })
})
