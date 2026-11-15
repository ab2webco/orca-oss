import { describe, expect, it } from 'vitest'
import { ORCHESTRATOR_GAME_ARCADE_DEFENSE } from '../../../../shared/orchestrator-game-arcade-file'
import { defenseStartOf } from '../../../../shared/orchestrator-game-arcade-defense-rules'
import { arcadeBoardOf } from './arcade-board'
import { DEFENSE_DRIVER } from './arcade-driver-defense'

const game = JSON.parse(ORCHESTRATOR_GAME_ARCADE_DEFENSE)
const view = { width: 800, height: 600 }
const start = defenseStartOf(game, 1)
const key = (code: string, isDown: boolean) => ({ kind: 'key' as const, code, isDown })

describe('DEFENSE_DRIVER', () => {
  it('holds the turret on an arrow or A/D until that key is let go', () => {
    const left = DEFENSE_DRIVER.inputOf(game, start, key('KeyA', true), view)
    expect(left?.move).toBe(-1)
    const bothRight = DEFENSE_DRIVER.inputOf(game, left!, key('ArrowRight', true), view)
    expect(DEFENSE_DRIVER.inputOf(game, bothRight!, key('KeyA', false), view)?.move).toBe(1)
    expect(DEFENSE_DRIVER.inputOf(game, bothRight!, key('ArrowRight', false), view)?.move).toBe(0)
    expect(DEFENSE_DRIVER.inputOf(game, start, key('KeyQ', true), view)).toBeNull()
  })

  it('fires on Space going down, not on its release', () => {
    expect(DEFENSE_DRIVER.inputOf(game, start, key('Space', true), view)?.isFiring).toBe(true)
    expect(DEFENSE_DRIVER.inputOf(game, start, key('Space', false), view)?.isFiring).toBe(false)
  })

  it('aims at the column under the pointer, and fires on a press', () => {
    const board = arcadeBoardOf(view, game.field)
    const x = board.left + 6.5 * board.cell
    const moved = DEFENSE_DRIVER.inputOf(
      game,
      start,
      { kind: 'pointer', x, y: 9, isPress: false },
      view
    )
    expect(moved).toMatchObject({ target: 6.5, isFiring: false })
    const pressed = DEFENSE_DRIVER.inputOf(
      game,
      start,
      { kind: 'pointer', x, y: 9, isPress: true },
      view
    )
    expect(pressed).toMatchObject({ target: 6.5, isFiring: true })
  })
})
