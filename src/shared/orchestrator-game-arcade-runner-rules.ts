import {
  courseGroupOf,
  feetOf,
  HERO_BODY,
  isLandedOf,
  JUMP_BUFFER_MS,
  launchOf,
  msToLandOf,
  runnerLevelOf,
  runnerSpeedAtOf,
  type RunnerAir,
  type RunnerCoin,
  type RunnerGame,
  type RunnerObstacle
} from './orchestrator-game-arcade-runner-flight'

export type {
  RunnerAir,
  RunnerCoin,
  RunnerGame,
  RunnerObstacle
} from './orchestrator-game-arcade-runner-flight'

// The runner's rules, apart from its drawing: time-based, seeded, and the same on every surface.
// Ported from the mod's arcade-runner.ts; a parity spec holds the two together until ORCA-1055.

/** An obstacle's height in pixels above the ground, one per column; `weight` is how often it comes. */
export type RunnerShape = { heights: readonly number[]; weight: number }

export type Runner<S extends RunnerShape = RunnerShape> = {
  game: RunnerGame
  shapes: readonly S[]
  totalWeight: number
}

export type RunnerState = {
  seed: number
  ms: number
  distance: number
  speed: number
  level: number
  /** The arc the hero is on; undefined on the ground. */
  air: RunnerAir | undefined
  /** Whether the one jump allowed in the air is still there. */
  hasAirJump: boolean
  /** A press just before touchdown: the hero takes off again as it lands. */
  isBuffered: boolean
  obstacles: readonly RunnerObstacle[]
  coins: readonly RunnerCoin[]
  /** World column the next group spawns at, and how many have spawned. */
  nextAt: number
  spawned: number
  /** Coins picked up in a row, and the points they made. */
  combo: number
  bonus: number
  score: number
  isOver: boolean
}

/** Screen columns the hero's feet hit with: the middle legs of its outlined costume. */
export const HERO_LEFT = 2
export const HERO_HITBOX = { left: HERO_LEFT + 4, width: 3 }
export const COIN_POINTS = 5
export const COMBO_MAX = 5
// Why: the widest band (160 columns at 1440 px) never shows an obstacle pop in.
const HORIZON = 200
const FIRST_GAP = 40
// Why: a frame that comes seconds late (a stalled host) must not jump the hero past an obstacle.
const MAX_STEP_MS = 100
// Why: checked a column at a time, a fast step cannot pass through the edge of an obstacle.
const SUBSTEP_COLUMNS = 0.5
const POINTS_PER_COLUMN = 0.1

export const runnerOf = <S extends RunnerShape>(
  game: RunnerGame,
  shapes: readonly S[]
): Runner<S> => ({
  game,
  shapes,
  totalWeight: shapes.reduce((sum, one) => sum + one.weight, 0)
})

const shapeWidthOf = (runner: Runner, shape: number): number =>
  runner.shapes[shape]?.heights.length ?? 0

const spawnedOf = (runner: Runner, state: RunnerState): RunnerState => {
  const obstacles = state.obstacles.filter(
    (one) => one.x + shapeWidthOf(runner, one.shape) > state.distance
  )
  const coins = [...state.coins]
  let { nextAt, spawned } = state
  const shapes = { shapes: runner.shapes, total: runner.totalWeight }
  while (nextAt < state.distance + HORIZON && runner.shapes.length > 0) {
    const reachedMs = state.ms + ((nextAt - state.distance) / state.speed) * 1000
    const group = courseGroupOf(runner.game, shapes, state.seed, spawned, nextAt, reachedMs)
    obstacles.push(...group.obstacles)
    coins.push(...group.coins)
    nextAt = group.end
    spawned += 1
  }
  return { ...state, obstacles, coins, nextAt, spawned }
}

export const runnerStartOf = (runner: Runner, seed: number): RunnerState =>
  spawnedOf(runner, {
    seed,
    ms: 0,
    distance: 0,
    speed: runner.game.speed.start,
    level: 1,
    air: undefined,
    hasAirJump: true,
    isBuffered: false,
    obstacles: [],
    coins: [],
    nextAt: FIRST_GAP,
    spawned: 0,
    combo: 0,
    bonus: 0,
    score: 0,
    isOver: false
  })

/** The hero's feet above the ground, in pixels. */
export const runnerHeightOf = (_runner: Runner, state: RunnerState): number =>
  state.air === undefined ? 0 : feetOf(state.air)

const isHitOf = (runner: Runner, state: RunnerState): boolean => {
  const feet = runnerHeightOf(runner, state)
  const left = state.distance + HERO_HITBOX.left
  return state.obstacles.some((one) => {
    const heights = runner.shapes[one.shape]?.heights ?? []
    return heights.some((height, column) => {
      const x = one.x + column
      return x + 1 > left && x < left + HERO_HITBOX.width && feet < height
    })
  })
}

// A coin the hero's body passes through is taken; one it runs past breaks the combo.
const coinsOf = (runner: Runner, state: RunnerState): RunnerState => {
  const feet = runnerHeightOf(runner, state)
  const left = state.distance + HERO_HITBOX.left
  let { combo, bonus } = state
  const coins = state.coins.filter((one) => {
    if (one.x + 1 <= left) {
      combo = 0
      return false
    }
    const isTaken = one.x < left + HERO_HITBOX.width && one.h >= feet && one.h < feet + HERO_BODY
    if (isTaken) {
      combo += 1
      bonus += COIN_POINTS * Math.min(COMBO_MAX, combo)
    }
    return !isTaken
  })
  return coins.length === state.coins.length ? state : { ...state, coins, combo, bonus }
}

const movedOf = (runner: Runner, state: RunnerState, dt: number): RunnerState => {
  const distance = state.distance + (state.speed * dt) / 1000
  const aired = state.air === undefined ? undefined : { ...state.air, ms: state.air.ms + dt }
  const isLanding = aired !== undefined && isLandedOf(aired)
  const air =
    isLanding && state.isBuffered
      ? launchOf(runner.game, state.speed, 0)
      : isLanding
        ? undefined
        : aired
  const moved = coinsOf(runner, {
    ...state,
    distance,
    air,
    hasAirJump: state.hasAirJump || isLanding,
    isBuffered: state.isBuffered && !isLanding
  })
  return isHitOf(runner, moved) ? { ...moved, isOver: true } : moved
}

// On the ground it jumps; high in the air it spends the air jump; about to land, it waits for it.
const pressedOf = (runner: Runner, state: RunnerState): RunnerState => {
  const { air } = state
  if (air === undefined) {
    return { ...state, air: launchOf(runner.game, state.speed, 0) }
  }
  if (msToLandOf(air) <= JUMP_BUFFER_MS) {
    return { ...state, isBuffered: true }
  }
  return state.hasAirJump
    ? { ...state, air: launchOf(runner.game, state.speed, feetOf(air)), hasAirJump: false }
    : state
}

/** Runs `dtMs` on, then takes the press, if any, at the end of it: the moment the key came. */
export const runnerStepOf = (
  runner: Runner,
  state: RunnerState,
  dtMs: number,
  isJump: boolean
): RunnerState => {
  if (state.isOver) {
    return state
  }
  const dt = Math.max(0, Math.min(MAX_STEP_MS, dtMs))
  const ms = state.ms + dt
  const speed = runnerSpeedAtOf(runner.game, ms)
  const parts = Math.max(1, Math.ceil((speed * dt) / 1000 / SUBSTEP_COLUMNS))
  let at: RunnerState = { ...state, ms, speed, level: runnerLevelOf(ms) }
  for (let i = 0; i < parts && !at.isOver; i += 1) {
    at = movedOf(runner, at, dt / parts)
  }
  const spawned = spawnedOf(runner, at)
  const pressed = isJump && !spawned.isOver ? pressedOf(runner, spawned) : spawned
  return {
    ...pressed,
    score: Math.floor(pressed.distance * POINTS_PER_COLUMN) + pressed.bonus
  }
}
