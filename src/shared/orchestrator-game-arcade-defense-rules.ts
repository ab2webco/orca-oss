import { arcadeRollOf } from './orchestrator-game-arcade-roll'

// The base defense's rules, apart from its drawing: bugs and red builds fall toward the merge line,
// the orca turret moves along it and fires. Time-based, seeded, in field units.

/** What the rules read of a game file. */
export type DefenseGame = {
  field: { columns: number; rows: number }
  /** Units per second, and the wait between two shots. */
  turret: { speed: number; cooldownMs: number }
  shot: { speed: number }
  /**
   * Fall speed in units per second, up by `rampPerWave` each wave to `max`; a new enemy every
   * `spawnMs`, shortening each wave down to `spawnMinMs`; a wave is `perWave` kills; from wave 2,
   * `buildShare` of them are two-hit red builds.
   */
  enemies: {
    start: number
    max: number
    rampPerWave: number
    spawnMs: number
    spawnMinMs: number
    perWave: number
    buildShare: number
  }
  lives: number
  points: { bug: number; build: number }
}

export type DefenseEnemyKind = 'bug' | 'build'
export type DefenseEnemy = { x: number; y: number; kind: DefenseEnemyKind; hp: number }
export type DefenseShot = { x: number; y: number }
export type DefenseMove = -1 | 0 | 1

export type DefenseState = {
  seed: number
  ms: number
  turret: number
  move: DefenseMove
  /** A pointer's column: the turret follows it until a key moves it again. */
  target: number | null
  /** A fire press waiting for the next frame. */
  isFiring: boolean
  /** The turret fires again from this run time. */
  readyAt: number
  shots: readonly DefenseShot[]
  enemies: readonly DefenseEnemy[]
  /** The next enemy falls in at this run time; `spawned` counts them and seeds each roll. */
  spawnAt: number
  spawned: number
  kills: number
  lives: number
  score: number
  isOver: boolean
}

/** Rows above the merge line's row, where a bug that lands costs a life. */
export const DEFENSE_MERGE_ROWS = 2
// Why 0.8: an enemy and a shot are drawn about a unit wide, so this is a touch, not a near miss.
const HIT_REACH = 0.8
const BUILD_HP = 2
// Why: a frame that comes seconds late (a stalled host) must not carry a shot through an enemy.
const MAX_STEP_MS = 100
const SUBSTEP_UNITS = 0.4

export const defenseMergeLineOf = (game: DefenseGame): number =>
  game.field.rows - DEFENSE_MERGE_ROWS

export const defenseWaveOf = (game: DefenseGame, kills: number): number =>
  1 + Math.floor(kills / game.enemies.perWave)

export const defenseFallSpeedOf = (game: DefenseGame, wave: number): number =>
  Math.min(game.enemies.max, game.enemies.start + game.enemies.rampPerWave * (wave - 1))

const spawnGapOf = (game: DefenseGame, wave: number): number =>
  Math.max(game.enemies.spawnMinMs, game.enemies.spawnMs * 0.85 ** (wave - 1))

export function defenseStartOf(game: DefenseGame, seed: number): DefenseState {
  return {
    seed,
    ms: 0,
    turret: game.field.columns / 2,
    move: 0,
    target: null,
    isFiring: false,
    readyAt: 0,
    shots: [],
    enemies: [],
    // Why at once: the ready screen is the beat; a start key must show the run moving.
    spawnAt: 0,
    spawned: 0,
    kills: 0,
    lives: game.lives,
    score: 0,
    isOver: false
  }
}

export const defenseMoveOf = (state: DefenseState, move: DefenseMove): DefenseState =>
  state.move === move && state.target === null ? state : { ...state, move, target: null }

export const defenseAimOf = (state: DefenseState, x: number): DefenseState => ({
  ...state,
  target: x
})

export const defenseFireOf = (state: DefenseState): DefenseState =>
  state.isOver ? state : { ...state, isFiring: true }

const turretMovedOf = (game: DefenseGame, state: DefenseState, dt: number): number => {
  const reach = (game.turret.speed * dt) / 1000
  const wanted =
    state.target === null
      ? state.turret + state.move * reach
      : state.turret + Math.max(-reach, Math.min(reach, state.target - state.turret))
  return Math.max(0.5, Math.min(game.field.columns - 0.5, wanted))
}

const spawnedOf = (game: DefenseGame, state: DefenseState): DefenseState => {
  if (state.ms < state.spawnAt) {
    return state
  }
  const n = state.spawned
  const wave = defenseWaveOf(game, state.kills)
  // Why from wave 2: the first wave teaches the turret on single-hit bugs.
  const isBuild = wave > 1 && arcadeRollOf(state.seed, n * 2 + 1) < game.enemies.buildShare
  const enemy: DefenseEnemy = {
    x: 0.5 + arcadeRollOf(state.seed, n * 2) * (game.field.columns - 1),
    // Why inside: the field is drawn framed, and an enemy above it would sit on the frame.
    y: 0.5,
    kind: isBuild ? 'build' : 'bug',
    hp: isBuild ? BUILD_HP : 1
  }
  return {
    ...state,
    enemies: [...state.enemies, enemy],
    spawned: n + 1,
    spawnAt: state.spawnAt + spawnGapOf(game, wave)
  }
}

const substepOf = (game: DefenseGame, state: DefenseState, dt: number): DefenseState => {
  const fall = (defenseFallSpeedOf(game, defenseWaveOf(game, state.kills)) * dt) / 1000
  const rise = (game.shot.speed * dt) / 1000
  let shots = state.shots.map((one) => ({ ...one, y: one.y - rise })).filter((one) => one.y > -1)
  let { kills, score, lives } = state
  const enemies: DefenseEnemy[] = []
  for (const one of state.enemies) {
    const moved = { ...one, y: one.y + fall }
    const shot = shots.find(
      (s) => Math.abs(s.x - moved.x) < HIT_REACH && Math.abs(s.y - moved.y) < HIT_REACH
    )
    if (shot) {
      shots = shots.filter((s) => s !== shot)
      if (moved.hp > 1) {
        enemies.push({ ...moved, hp: moved.hp - 1 })
      } else {
        kills += 1
        score += game.points[moved.kind]
      }
    } else if (moved.y >= defenseMergeLineOf(game)) {
      lives -= 1
    } else {
      enemies.push(moved)
    }
  }
  return {
    ...state,
    ms: state.ms + dt,
    turret: turretMovedOf(game, state, dt),
    shots,
    enemies,
    kills,
    score,
    lives,
    isOver: lives <= 0
  }
}

const firedOf = (game: DefenseGame, state: DefenseState): DefenseState => {
  if (!state.isFiring) {
    return state
  }
  if (state.ms < state.readyAt) {
    return { ...state, isFiring: false }
  }
  return {
    ...state,
    isFiring: false,
    readyAt: state.ms + game.turret.cooldownMs,
    shots: [...state.shots, { x: state.turret, y: defenseMergeLineOf(game) - 0.5 }]
  }
}

/** Runs `dtMs` on in substeps short enough that no shot passes through an enemy. */
export function defenseStepOf(game: DefenseGame, state: DefenseState, dtMs: number): DefenseState {
  if (state.isOver) {
    return state
  }
  const dt = Math.max(0, Math.min(MAX_STEP_MS, dtMs))
  const fastest = Math.max(game.shot.speed, game.turret.speed, game.enemies.max)
  const parts = Math.max(1, Math.ceil((fastest * dt) / 1000 / SUBSTEP_UNITS))
  let at = firedOf(game, state)
  for (let i = 0; i < parts && !at.isOver; i += 1) {
    at = spawnedOf(game, substepOf(game, at, dt / parts))
  }
  return at
}
