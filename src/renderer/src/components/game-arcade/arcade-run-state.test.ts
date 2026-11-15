import { describe, expect, it } from 'vitest'
import {
  ARCADE_FRAME_MS,
  arcadeRunOf,
  inputArcadeRun,
  stepArcadeRun,
  type ArcadeInput,
  type ArcadeRun
} from './arcade-run-state'
import { arcadeShapesOf } from './arcade-driver-runner'
import {
  ORCHESTRATOR_GAME_ARCADE_RUNNER,
  ORCHESTRATOR_GAME_ARCADE_SNAKE
} from '../../../../shared/orchestrator-game-arcade-file'

const runner = JSON.parse(ORCHESTRATOR_GAME_ARCADE_RUNNER)
const snake = JSON.parse(ORCHESTRATOR_GAME_ARCADE_SNAKE)
const VIEW = { width: 800, height: 600 }
const key = (code: string, isDown = true): ArcadeInput => ({ kind: 'key', code, isDown })
const TAP: ArcadeInput = { kind: 'pointer', x: 10, y: 10, isPress: true }
const send = (run: ArcadeRun, input: ArcadeInput) => inputArcadeRun(run, input, VIEW)

const playedOut = (run: ArcadeRun): ArcadeRun => {
  let at = run
  for (let i = 0; i < 4000 && at.screen !== 'over'; i += 1) {
    at = stepArcadeRun(at, ARCADE_FRAME_MS, false).run
  }
  return at
}

describe('arcadeShapesOf', () => {
  it("reads each sprite obstacle's column heights and skips the scene's decoration", () => {
    expect(arcadeShapesOf(runner)).toEqual([
      expect.objectContaining({ heights: [2, 3, 3, 2], weight: 0.35 })
    ])
  })
})

describe('the arcade run', () => {
  it.each([
    ['runner', runner, 'Space'],
    ['snake', snake, 'ArrowUp']
  ])('waits for the first press of the %s, then runs by real time', (_name, game, start) => {
    const ready = arcadeRunOf(game, 7)
    expect(stepArcadeRun(ready, 500, false).run.play.ms).toBe(0)
    expect(send(ready, key('KeyQ')).run.screen).toBe('ready')
    const running = send(ready, key(start)).run
    expect(running.screen).toBe('running')
    expect(stepArcadeRun(running, 80, false).run.play.ms).toBe(80)
  })

  it('starts on a tap too', () => {
    expect(send(arcadeRunOf(runner, 7), TAP).run.screen).toBe('running')
  })

  it('stands still while someone needs the user, ignores presses, and goes on once answered', () => {
    const running = send(arcadeRunOf(snake, 7), key('Space')).run
    const held = stepArcadeRun(running, 80, true).run
    expect(held.screen).toBe('held')
    expect(held.play.ms).toBe(0)
    expect(send(held, key('ArrowUp')).isGame).toBe(false)
    expect(stepArcadeRun(held, 80, false).run).toMatchObject({ screen: 'running' })
  })

  it.each([
    ['runner', runner],
    ['snake', snake]
  ])(
    'ends the %s run, keeps the best score, and only Space, Enter or a tap closes it',
    (_name, game) => {
      const run = playedOut(send(arcadeRunOf(game, 7, 3), key('Space')).run)
      expect(run.screen).toBe('over')
      expect(run.best).toBe(Math.max(3, run.play.score))
      expect(send(run, key('ArrowUp')).close).toBe(false)
      expect(send(run, key('Space')).close).toBe(true)
      expect(send(run, key('Enter')).close).toBe(true)
      expect(send(run, TAP).close).toBe(true)
    }
  )

  it('reports a new frame only when something moved', () => {
    const ready = arcadeRunOf(runner, 7)
    expect(stepArcadeRun(ready, 33, false).changed).toBe(false)
    expect(stepArcadeRun(send(ready, key('Space')).run, 33, false).changed).toBe(true)
  })
})

describe('the snake through the run', () => {
  it('steers with its first arrow and with WASD, and leaves other keys to the page', () => {
    const started = send(arcadeRunOf(snake, 7), key('ArrowUp')).run
    const steered = stepArcadeRun(started, 1000 / 6, false).run
    const turned = send(steered, key('KeyA'))
    expect(turned.isGame).toBe(true)
    expect(send(steered, key('KeyQ')).isGame).toBe(false)
  })
})
