import { describe, expect, it } from 'vitest'
import {
  ORCHESTRATOR_GAME_ARCADE_FPS_MAX,
  ORCHESTRATOR_GAME_ARCADE_MAX_BYTES,
  ORCHESTRATOR_GAME_ARCADE_ENGINES,
  ORCHESTRATOR_GAME_ARCADE_RUNNER,
  ORCHESTRATOR_GAME_ARCADE_SNAKE,
  ORCHESTRATOR_GAME_ARCADE_BRICKS,
  orchestratorGameArcadeIssues,
  parseOrchestratorGameArcade,
  pickOrchestratorGameArcadeEngine
} from './orchestrator-game-arcade-file'

const runner = (): Record<string, unknown> => JSON.parse(ORCHESTRATOR_GAME_ARCADE_RUNNER)

describe('orchestratorGameArcadeIssues', () => {
  it('finds nothing in the built-in runner', () => {
    expect(orchestratorGameArcadeIssues(ORCHESTRATOR_GAME_ARCADE_RUNNER)).toEqual([])
  })

  it('parses the built-in runner with its colors as numbers and the scene obstacle kept', () => {
    const parsed = parseOrchestratorGameArcade(ORCHESTRATOR_GAME_ARCADE_RUNNER)
    expect(parsed.ok).toBe(true)
    const game = parsed.ok && parsed.game.engine === 'runner' ? parsed.game : undefined
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
      'engine: must be one of: runner, snake, bricks',
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

describe('the snake game file', () => {
  const snake = (): Record<string, unknown> => JSON.parse(ORCHESTRATOR_GAME_ARCADE_SNAKE)

  it('finds nothing in the built-in snake, inert data well under the size cap', () => {
    expect(orchestratorGameArcadeIssues(ORCHESTRATOR_GAME_ARCADE_SNAKE)).toEqual([])
    expect(new TextEncoder().encode(ORCHESTRATOR_GAME_ARCADE_SNAKE).length).toBeLessThan(
      ORCHESTRATOR_GAME_ARCADE_MAX_BYTES
    )
  })

  it('lists every snake problem with its path', () => {
    const game = snake()
    game.grid = { columns: 4, rows: 8.5 }
    game.speed = { start: 10, max: 5, rampPerFood: 0 }
    game.colors = { head: 'green', body: '#00ff00', food: '#ff0000' }
    expect(orchestratorGameArcadeIssues(JSON.stringify(game))).toEqual([
      'grid.columns: must be a whole number from 12 to 40',
      'grid.rows: must be a whole number from 8 to 30',
      'speed.max: must be at least speed.start',
      'colors.head: must be a #rrggbb color or an integer from 0 to 16777215'
    ])
  })
})

describe('pickOrchestratorGameArcadeEngine', () => {
  it('reaches every built-in game across the roll', () => {
    const picked = new Set([0, 0.25, 0.5, 0.75, 0.999999].map(pickOrchestratorGameArcadeEngine))
    expect([...picked].sort()).toEqual([...ORCHESTRATOR_GAME_ARCADE_ENGINES].sort())
    expect(pickOrchestratorGameArcadeEngine(1)).toBe(ORCHESTRATOR_GAME_ARCADE_ENGINES.at(-1))
  })
})

describe('the brick breaker game file', () => {
  const bricks = (): Record<string, unknown> => JSON.parse(ORCHESTRATOR_GAME_ARCADE_BRICKS)

  it('finds nothing in the built-in brick breaker', () => {
    expect(orchestratorGameArcadeIssues(ORCHESTRATOR_GAME_ARCADE_BRICKS)).toEqual([])
    expect(parseOrchestratorGameArcade(ORCHESTRATOR_GAME_ARCADE_BRICKS)).toMatchObject({
      ok: true,
      game: { engine: 'bricks' }
    })
  })

  it('lists every brick breaker problem with its path', () => {
    const game = bricks()
    game.wall = { columns: 20, rows: 5, points: 5 }
    game.ball = { start: 20, max: 10, rampPerWall: 1 }
    game.colors = { bricks: [], paddle: '#ffffff', ball: '#ffffff' }
    game.portrait = { field: { columns: 20, rows: 20 }, wall: { columns: 5, rows: 5 }, paddle: {} }
    expect(orchestratorGameArcadeIssues(JSON.stringify(game))).toEqual([
      'wall.columns: must be a whole number from 4 to 16',
      'ball.max: must be at least ball.start',
      'colors.bricks: Too small: expected array to have >=1 items',
      'portrait.paddle.width: must be from 2 to 10'
    ])
  })

  it('wants a portrait field taller than wide', () => {
    const game = bricks()
    game.portrait = {
      field: { columns: 20, rows: 20 },
      wall: { columns: 5, rows: 5 },
      paddle: { width: 4 }
    }
    expect(orchestratorGameArcadeIssues(JSON.stringify(game))).toEqual([
      'portrait.field.rows: must be more than field.columns'
    ])
  })
})
