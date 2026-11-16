import { arcadeRollOf } from './orchestrator-game-arcade-roll'

// The brick breaker's rules, apart from its drawing: time-based, seeded, in field units (one unit is
// a brick row tall), and the same on every surface.

/** What the rules read of a game file. */
export type BricksGame = {
  /** In field units: one unit is a brick row tall. */
  field: { columns: number; rows: number }
  wall: { columns: number; rows: number; points: number }
  /** Paddle width in units, speed in units per second. */
  paddle: { width: number; speed: number }
  /** Units per second; each cleared wall adds `rampPerWall` until `max`. */
  ball: { start: number; max: number; rampPerWall: number }
  /** How often a broken brick drops a power-up, and how long a wide paddle lasts. */
  powerUps: { chance: number; wideMs: number }
}

export type BricksBall = { x: number; y: number; vx: number; vy: number }
export type BricksDropKind = 'multi' | 'wide'
export type BricksDrop = { x: number; y: number; kind: BricksDropKind }
export type BricksMove = -1 | 0 | 1

export type BricksState = {
  seed: number
  ms: number
  /** The paddle's center. */
  paddle: number
  /** Held arrow keys; a pointer's `target` wins while it is set. */
  move: BricksMove
  target: number | null
  balls: readonly BricksBall[]
  /** Row-major, top row first; true while the brick stands. */
  bricks: readonly boolean[]
  drops: readonly BricksDrop[]
  /** The paddle is wide until this run time. */
  wideUntil: number
  /** The wall being played, from 1; each cleared wall brings a faster one. */
  wall: number
  /** Bricks broken so far, which also seeds each drop roll. */
  broken: number
  score: number
  isOver: boolean
}

export const BRICKS_BALL_RADIUS = 0.35
export const BRICKS_PADDLE_HEIGHT = 0.6
/** Rows of sky above the wall, so a ball can run behind it. */
export const BRICKS_WALL_TOP = 2
const WIDE_SCALE = 1.6
const DROP_SPEED = 6
// Why 60°: a ball off the paddle's edge still climbs instead of skimming sideways forever.
const MAX_BOUNCE = Math.PI / 3
// Why: a frame that comes seconds late (a stalled host) must not carry a ball through the wall.
const MAX_STEP_MS = 100
const SUBSTEP_UNITS = 0.25

export const bricksPaddleTopOf = (game: BricksGame): number => game.field.rows - 1.5

export const bricksPaddleWidthOf = (game: BricksGame, state: BricksState): number =>
  game.paddle.width * (state.ms < state.wideUntil ? WIDE_SCALE : 1)

export const bricksBallSpeedOf = (game: BricksGame, wall: number): number =>
  Math.min(game.ball.max, game.ball.start + game.ball.rampPerWall * (wall - 1))

export const bricksBrickWidthOf = (game: BricksGame): number =>
  game.field.columns / game.wall.columns

const servedOf = (game: BricksGame, paddle: number, wall: number): BricksBall => {
  const speed = bricksBallSpeedOf(game, wall)
  // Why off-vertical: a ball served straight up would only ever hit one column.
  const angle = MAX_BOUNCE / 3
  return {
    x: paddle,
    y: bricksPaddleTopOf(game) - BRICKS_BALL_RADIUS,
    vx: speed * Math.sin(angle),
    vy: -speed * Math.cos(angle)
  }
}

export function bricksStartOf(game: BricksGame, seed: number): BricksState {
  const paddle = game.field.columns / 2
  return {
    seed,
    ms: 0,
    paddle,
    move: 0,
    target: null,
    balls: [servedOf(game, paddle, 1)],
    bricks: Array.from({ length: game.wall.columns * game.wall.rows }, () => true),
    drops: [],
    wideUntil: 0,
    wall: 1,
    broken: 0,
    score: 0,
    isOver: false
  }
}

export const bricksMoveOf = (state: BricksState, move: BricksMove): BricksState =>
  state.move === move && state.target === null ? state : { ...state, move, target: null }

/** A pointer over the field: the paddle follows it until a key moves it again. */
export const bricksAimOf = (state: BricksState, x: number): BricksState => ({ ...state, target: x })

const paddleMovedOf = (game: BricksGame, state: BricksState, dt: number): number => {
  const reach = (game.paddle.speed * dt) / 1000
  const half = bricksPaddleWidthOf(game, state) / 2
  const wanted =
    state.target === null
      ? state.paddle + state.move * reach
      : state.paddle + Math.max(-reach, Math.min(reach, state.target - state.paddle))
  return Math.max(half, Math.min(game.field.columns - half, wanted))
}

type Hit = { ball: BricksBall; brick: number | null }

const brickAtOf = (game: BricksGame, bricks: readonly boolean[], x: number, y: number) => {
  const row = Math.floor(y - BRICKS_WALL_TOP)
  const column = Math.floor(x / bricksBrickWidthOf(game))
  if (row < 0 || row >= game.wall.rows || column < 0 || column >= game.wall.columns) {
    return null
  }
  const index = row * game.wall.columns + column
  return bricks[index] ? index : null
}

// One substep of one ball: the walls and the bricks; the paddle comes after, with the paddle moved.
const ballMovedOf = (
  game: BricksGame,
  bricks: readonly boolean[],
  ball: BricksBall,
  dt: number
): Hit => {
  let { x, y, vx, vy } = ball
  x += (vx * dt) / 1000
  y += (vy * dt) / 1000
  if (x < BRICKS_BALL_RADIUS || x > game.field.columns - BRICKS_BALL_RADIUS) {
    x = Math.max(BRICKS_BALL_RADIUS, Math.min(game.field.columns - BRICKS_BALL_RADIUS, x))
    vx = -vx
  }
  if (y < BRICKS_BALL_RADIUS) {
    y = BRICKS_BALL_RADIUS
    vy = Math.abs(vy)
  }
  const brick = brickAtOf(game, bricks, x, y)
  if (brick !== null) {
    // Why the column test: a ball that came in from the side bounces sideways, else up or down.
    const fromSide = brickAtOf(game, bricks, ball.x, y) === null
    if (fromSide) {
      vx = -vx
      x = ball.x
    } else {
      vy = -vy
      y = ball.y
    }
  }
  return { ball: { x, y, vx, vy }, brick }
}

const bouncedOf = (game: BricksGame, state: BricksState, ball: BricksBall): BricksBall => {
  const top = bricksPaddleTopOf(game)
  const half = bricksPaddleWidthOf(game, state) / 2
  const isOnPaddle =
    ball.vy > 0 &&
    ball.y + BRICKS_BALL_RADIUS >= top &&
    ball.y - BRICKS_BALL_RADIUS <= top + BRICKS_PADDLE_HEIGHT &&
    Math.abs(ball.x - state.paddle) <= half + BRICKS_BALL_RADIUS
  if (!isOnPaddle) {
    return ball
  }
  const offset = Math.max(-1, Math.min(1, (ball.x - state.paddle) / half))
  const speed = bricksBallSpeedOf(game, state.wall)
  return {
    x: ball.x,
    y: top - BRICKS_BALL_RADIUS,
    vx: speed * Math.sin(offset * MAX_BOUNCE),
    vy: -speed * Math.cos(offset * MAX_BOUNCE)
  }
}

const dropOf = (game: BricksGame, state: BricksState, brick: number): BricksDrop | null => {
  if (arcadeRollOf(state.seed, state.broken * 2) >= game.powerUps.chance) {
    return null
  }
  const width = bricksBrickWidthOf(game)
  return {
    x: ((brick % game.wall.columns) + 0.5) * width,
    y: BRICKS_WALL_TOP + Math.floor(brick / game.wall.columns) + 0.5,
    kind: arcadeRollOf(state.seed, state.broken * 2 + 1) < 0.5 ? 'multi' : 'wide'
  }
}

const caughtOf = (game: BricksGame, state: BricksState, drop: BricksDrop): BricksState => {
  if (drop.kind === 'wide') {
    return { ...state, wideUntil: state.ms + game.powerUps.wideMs }
  }
  const lead = state.balls[0]
  if (!lead) {
    return state
  }
  const speed = Math.hypot(lead.vx, lead.vy)
  const split = (turn: number): BricksBall => {
    const angle = Math.atan2(lead.vx, -lead.vy) + turn
    return { ...lead, vx: speed * Math.sin(angle), vy: -speed * Math.cos(angle) }
  }
  return { ...state, balls: [...state.balls, split(0.4), split(-0.4)] }
}

const substepOf = (game: BricksGame, state: BricksState, dt: number): BricksState => {
  let at: BricksState = { ...state, ms: state.ms + dt, paddle: paddleMovedOf(game, state, dt) }
  const balls: BricksBall[] = []
  const drops = [...at.drops]
  let bricks = at.bricks
  for (const one of at.balls) {
    const hit = ballMovedOf(game, bricks, one, dt)
    if (hit.brick !== null) {
      bricks = bricks.map((alive, i) => alive && i !== hit.brick)
      const drop = dropOf(game, at, hit.brick)
      if (drop) {
        drops.push(drop)
      }
      at = { ...at, broken: at.broken + 1, score: at.score + game.wall.points * at.wall }
    }
    const ball = bouncedOf(game, at, hit.ball)
    if (ball.y - BRICKS_BALL_RADIUS <= game.field.rows) {
      balls.push(ball)
    }
  }
  at = { ...at, balls, bricks, drops: [] }
  const top = bricksPaddleTopOf(game)
  const half = bricksPaddleWidthOf(game, at) / 2
  for (const drop of drops) {
    const y = drop.y + (DROP_SPEED * dt) / 1000
    if (y >= top && y <= top + BRICKS_PADDLE_HEIGHT && Math.abs(drop.x - at.paddle) <= half) {
      at = caughtOf(game, at, drop)
    } else if (y <= game.field.rows) {
      at = { ...at, drops: [...at.drops, { ...drop, y }] }
    }
  }
  if (at.balls.length === 0) {
    return { ...at, isOver: true }
  }
  if (at.bricks.every((alive) => !alive)) {
    const wall = at.wall + 1
    return {
      ...at,
      wall,
      bricks: at.bricks.map(() => true),
      balls: [servedOf(game, at.paddle, wall)],
      drops: []
    }
  }
  return at
}

/** Runs `dtMs` on in substeps short enough that no ball skips a brick. */
export function bricksStepOf(game: BricksGame, state: BricksState, dtMs: number): BricksState {
  if (state.isOver) {
    return state
  }
  const dt = Math.max(0, Math.min(MAX_STEP_MS, dtMs))
  const fastest = Math.max(game.paddle.speed, bricksBallSpeedOf(game, state.wall) * 1.5)
  const parts = Math.max(1, Math.ceil((fastest * dt) / 1000 / SUBSTEP_UNITS))
  let at = state
  for (let i = 0; i < parts && !at.isOver; i += 1) {
    at = substepOf(game, at, dt / parts)
  }
  return at
}
