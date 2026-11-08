import { describe, expect, it } from 'vitest'
import {
  ARCADE_FRAME_MS,
  arcadeRunOf,
  arcadeShapesOf,
  pressArcadeRun,
  stepArcadeRun
} from './arcade-run-state'
import { ORCHESTRATOR_GAME_ARCADE_RUNNER } from '../../../../shared/orchestrator-game-arcade-file'

const game = JSON.parse(ORCHESTRATOR_GAME_ARCADE_RUNNER)

describe('arcadeShapesOf', () => {
  it("reads each sprite obstacle's column heights and skips the scene's decoration", () => {
    expect(arcadeShapesOf(game)).toEqual([
      expect.objectContaining({ heights: [2, 3, 3, 2], weight: 0.35 })
    ])
  })
})

describe('the arcade run', () => {
  it('waits for the first press, then runs by real time', () => {
    const ready = arcadeRunOf(game, 7)
    expect(ready.screen).toBe('ready')
    expect(stepArcadeRun(ready, 500, false).run.state.ms).toBe(0)
    const running = pressArcadeRun(ready).run
    expect(running.screen).toBe('running')
    expect(stepArcadeRun(running, 80, false).run.state.ms).toBe(80)
  })

  it('stands still while someone needs the user and goes on once answered', () => {
    const running = pressArcadeRun(arcadeRunOf(game, 7)).run
    const held = stepArcadeRun(running, 80, true).run
    expect(held.screen).toBe('held')
    expect(held.state.ms).toBe(0)
    expect(pressArcadeRun(held).run.state.air).toBeUndefined()
    expect(stepArcadeRun(held, 80, false).run).toMatchObject({ screen: 'running' })
  })

  it('ends on a hit, keeps the best score, and a press then asks to close', () => {
    let run = pressArcadeRun(arcadeRunOf(game, 7, 3)).run
    for (let i = 0; i < 2000 && run.screen !== 'over'; i += 1) {
      run = stepArcadeRun(run, ARCADE_FRAME_MS, false).run
    }
    expect(run.screen).toBe('over')
    expect(run.best).toBe(Math.max(3, run.state.score))
    expect(pressArcadeRun(run).close).toBe(true)
  })

  it('reports a new frame only when something moved', () => {
    const ready = arcadeRunOf(game, 7)
    expect(stepArcadeRun(ready, 33, false).changed).toBe(false)
    expect(stepArcadeRun(pressArcadeRun(ready).run, 33, false).changed).toBe(true)
  })
})
