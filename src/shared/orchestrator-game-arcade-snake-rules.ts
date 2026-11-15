import { arcadeHashOf } from './orchestrator-game-arcade-roll'

// The snake's rules, apart from its drawing: time-based, seeded, and the same on every surface.

/** What the rules read of a game file. */
export type SnakeGame = {
  grid: { columns: number; rows: number }
  /** Cells per second; each food eaten adds `rampPerFood` until `max`. */
  speed: { start: number; max: number; rampPerFood: number }
  start: { length: number }
  food: { points: number; growth: number }
}

export type SnakeDirection = 'up' | 'down' | 'left' | 'right'
export type SnakeCell = { x: number; y: number }

export type SnakeState = {
  seed: number
  ms: number
  /** Time banked toward the next cell. */
  carry: number
  /** Head first. */
  body: readonly SnakeCell[]
  heading: SnakeDirection
  /** Turns pressed faster than the snake moves, taken one per cell. */
  turns: readonly SnakeDirection[]
  /** Null once the board is full. */
  food: SnakeCell | null
  eaten: number
  /** Cells still to grow: the tail stays put while this is above zero. */
  growth: number
  score: number
  isOver: boolean
}

const STEP: Record<SnakeDirection, SnakeCell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
}
const OPPOSITE: Record<SnakeDirection, SnakeDirection> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left'
}
// Why two: a quick corner (up, then left) lands, a third press would steer cells ahead of the eye.
const TURNS_MAX = 2
// Why: a frame that comes seconds late (a stalled host) must not move the snake cells unseen.
const MAX_STEP_MS = 100

const isSame = (a: SnakeCell, b: SnakeCell): boolean => a.x === b.x && a.y === b.y

export const snakeSpeedOf = (game: SnakeGame, eaten: number): number =>
  Math.min(game.speed.max, game.speed.start + game.speed.rampPerFood * eaten)

/** A free cell picked from the run's seed and how much it has eaten; null on a full board. */
export function snakeFoodOf(
  game: SnakeGame,
  body: readonly SnakeCell[],
  seed: number,
  eaten: number
): SnakeCell | null {
  const taken = new Set(body.map((one) => one.y * game.grid.columns + one.x))
  const free: SnakeCell[] = []
  for (let y = 0; y < game.grid.rows; y += 1) {
    for (let x = 0; x < game.grid.columns; x += 1) {
      if (!taken.has(y * game.grid.columns + x)) {
        free.push({ x, y })
      }
    }
  }
  return free.length === 0 ? null : (free[arcadeHashOf(seed, eaten) % free.length] ?? null)
}

/** Mid-board, heading right, its tail trailing to the left. */
export function snakeStartOf(game: SnakeGame, seed: number): SnakeState {
  const y = Math.floor(game.grid.rows / 2)
  const headX = Math.floor(game.grid.columns / 2)
  const body = Array.from({ length: game.start.length }, (_, i) => ({ x: headX - i, y }))
  return {
    seed,
    ms: 0,
    carry: 0,
    body,
    heading: 'right',
    turns: [],
    food: snakeFoodOf(game, body, seed, 0),
    eaten: 0,
    growth: 0,
    score: 0,
    isOver: false
  }
}

/** Queues a turn; one back into the snake's own neck, or a repeat, is ignored. */
export function snakeTurnOf(state: SnakeState, direction: SnakeDirection): SnakeState {
  const last = state.turns.at(-1) ?? state.heading
  if (
    state.isOver ||
    state.turns.length >= TURNS_MAX ||
    direction === last ||
    direction === OPPOSITE[last]
  ) {
    return state
  }
  return { ...state, turns: [...state.turns, direction] }
}

const movedOf = (game: SnakeGame, state: SnakeState): SnakeState => {
  const [turn, ...turns] = state.turns
  const heading = turn ?? state.heading
  const head = state.body[0]
  if (!head) {
    return { ...state, isOver: true }
  }
  const next = { x: head.x + STEP[heading].x, y: head.y + STEP[heading].y }
  const isOffBoard =
    next.x < 0 || next.y < 0 || next.x >= game.grid.columns || next.y >= game.grid.rows
  const isGrowing = state.growth > 0
  // Why: the tail leaves its cell on this same move unless the snake is growing.
  const rest = isGrowing ? state.body : state.body.slice(0, -1)
  if (isOffBoard || rest.some((one) => isSame(one, next))) {
    return { ...state, heading, turns, isOver: true }
  }
  const body = [next, ...rest]
  const isEating = state.food !== null && isSame(state.food, next)
  const eaten = state.eaten + (isEating ? 1 : 0)
  const food = isEating ? snakeFoodOf(game, body, state.seed, eaten) : state.food
  return {
    ...state,
    body,
    heading,
    turns,
    food,
    eaten,
    growth: state.growth - (isGrowing ? 1 : 0) + (isEating ? game.food.growth : 0),
    score: state.score + (isEating ? game.food.points : 0),
    isOver: food === null
  }
}

/** Runs `dtMs` on, moving one cell each time a cell's worth of time is banked. */
export function snakeStepOf(game: SnakeGame, state: SnakeState, dtMs: number): SnakeState {
  if (state.isOver) {
    return state
  }
  const dt = Math.max(0, Math.min(MAX_STEP_MS, dtMs))
  let at: SnakeState = { ...state, ms: state.ms + dt, carry: state.carry + dt }
  let cellMs = 1000 / snakeSpeedOf(game, at.eaten)
  while (!at.isOver && at.carry >= cellMs) {
    at = movedOf(game, { ...at, carry: at.carry - cellMs })
    cellMs = 1000 / snakeSpeedOf(game, at.eaten)
  }
  return at
}
