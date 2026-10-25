import { describe, expect, it } from 'vitest'
import {
  ORCHESTRATOR_GAME_ARCADE_FPS_MAX,
  ORCHESTRATOR_GAME_ARCADE_MAX_BYTES,
  ORCHESTRATOR_GAME_ARCADE_RUNNER,
  orchestratorGameArcadeIssues,
  parseOrchestratorGameArcade
} from './orchestrator-game-arcade-file'

const runner = (): Record<string, unknown> => JSON.parse(ORCHESTRATOR_GAME_ARCADE_RUNNER)

describe('orchestratorGameArcadeIssues', () => {
  it('finds nothing in the built-in runner', () => {
    expect(orchestratorGameArcadeIssues(ORCHESTRATOR_GAME_ARCADE_RUNNER)).toEqual([])
  })

  it('parses the built-in runner with its colors as numbers and the scene obstacle kept', () => {
    const parsed = parseOrchestratorGameArcade(ORCHESTRATOR_GAME_ARCADE_RUNNER)
    expect(parsed.ok).toBe(true)
    const game = parsed.ok ? parsed.game : undefined
    expect(game?.engine).toBe('runner')
    expect(game?.fps).toBeLessThanOrEqual(ORCHESTRATOR_GAME_ARCADE_FPS_MAX)
    expect(game?.obstacles.some((one) => 'from' in one && one.from === 'scene')).toBe(true)
    expect(
      parseOrchestratorGameArcade(
        JSON.stringify({
          ...runner(),
          obstacles: [{ from: 'scene' }, { rows: ['X'], colors: { X: 1 } }]
        })
      )
    ).toMatchObject({ ok: true, game: { obstacles: [{ weight: 1 }, { weight: 1 }] } })
    const sprite = game?.obstacles.find((one) => 'rows' in one)
    expect(sprite && 'colors' in sprite && Object.values(sprite.colors)).toEqual(
      expect.arrayContaining([expect.any(Number)])
    )
  })

  it('caps the frame rate the terminal is asked to draw', () => {
    const game = runner()
    game.fps = ORCHESTRATOR_GAME_ARCADE_FPS_MAX + 1
    expect(orchestratorGameArcadeIssues(JSON.stringify(game))).toEqual([
      `fps: must be a whole number from 5 to ${ORCHESTRATOR_GAME_ARCADE_FPS_MAX}`
    ])
  })

  it('lists every problem with the path that has it, not only the first', () => {
    const game = runner()
    game.engine = 'pinball'
    game.speed = { start: 30, max: 10, rampPerMinute: 4 }
    game.difficulty = { minGap: 40, maxGap: 20 }
    game.obstacles = [{ from: 'scene' }, { rows: ['XY', 'X'], colors: { X: '#ffffff' } }]
    expect(orchestratorGameArcadeIssues(JSON.stringify(game))).toEqual([
      'engine: must be one of: runner',
      'speed.max: must be at least speed.start',
      'difficulty.maxGap: must be at least difficulty.minGap',
      'obstacles.1.rows: every row must be the same width',
      'obstacles.1.colors: glyph "Y" has no color'
    ])
  })

  it('needs one drawn obstacle, since a scene can have no ground decoration', () => {
    const game = runner()
    game.obstacles = [{ from: 'scene', weight: 1 }]
    expect(orchestratorGameArcadeIssues(JSON.stringify(game))).toEqual([
      'obstacles: needs at least one sprite obstacle for scenes with no ground decoration'
    ])
  })

  it('takes a theme of look colors and refuses an empty one', () => {
    const game = runner()
    game.theme = { sky: '#000000' }
    expect(orchestratorGameArcadeIssues(JSON.stringify(game))).toEqual([
      'theme: must set at least one look color'
    ])
    game.theme = { skyTop: '#000000' }
    expect(orchestratorGameArcadeIssues(JSON.stringify(game))).toEqual([])
  })

  it('ignores keys it does not know, so a newer game file still loads', () => {
    const game = runner()
    game.lives = 3
    expect(orchestratorGameArcadeIssues(JSON.stringify(game))).toEqual([])
  })

  it('refuses text too large for the game to read before parsing it', () => {
    const big = JSON.stringify({ ...runner(), pad: 'x'.repeat(ORCHESTRATOR_GAME_ARCADE_MAX_BYTES) })
    expect(orchestratorGameArcadeIssues(big)).toEqual([
      `larger than ${ORCHESTRATOR_GAME_ARCADE_MAX_BYTES / 1024} KB`
    ])
  })

  it('says when the text is not JSON at all', () => {
    expect(orchestratorGameArcadeIssues('{ engine: ')).toEqual(['not valid JSON'])
  })
})
