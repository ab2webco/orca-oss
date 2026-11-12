import { teamSceneArrived as near } from './team-scene-motion'
import { pileSpotOf } from './team-scene-sites'
import type { TeamSceneBody, TeamSceneWorld } from './team-scene-director'
import type { TeamScenePlay } from './team-scene-types'

// Why: one strike in place reads as drumming; V30 and builder games show a round trip instead.
const BUILD_SECONDS = 2.6
const REPAIR_PUFF_SECONDS = 1.2
const PAUSE_SECONDS = 2.5
const STROLL_X = 0.06
const PLAY_SECONDS = 14
const PLAYS: readonly TeamScenePlay[] = ['music', 'sketch', 'plane', 'game']

export type TeamSceneWork = {
  step: 'build' | 'fetch' | 'carry' | 'repair' | 'pause' | 'stroll' | 'still' | 'play'
  at: number
  strolls: number
}

export const createTeamSceneWork = (): TeamSceneWork => ({ step: 'build', at: 0, strolls: 0 })

const go = (world: TeamSceneWorld, body: TeamSceneBody, step: TeamSceneWork['step']): void => {
  Object.assign(body.work, { step, at: world.t })
}

function stepWorking(world: TeamSceneWorld, body: TeamSceneBody, width: number): void {
  const { work } = body
  if (body.site.broken) {
    if (work.step !== 'repair') {
      go(world, body, 'repair')
    }
    body.target = body.home
    if (near(body, width) && world.t - work.at >= REPAIR_PUFF_SECONDS) {
      work.at = world.t
      world.effects.push({ kind: 'burst', key: body.key, reason: 'repair' })
    }
    return
  }
  if (work.step === 'fetch') {
    body.target = pileSpotOf(body.home)
    if (near(body, width)) {
      go(world, body, 'carry')
    }
  } else if (work.step === 'carry') {
    body.target = body.home
    if (near(body, width)) {
      go(world, body, 'build')
    }
  } else if (work.step === 'build') {
    body.target = body.home
    if (world.t - work.at >= BUILD_SECONDS) {
      world.effects.push({ kind: 'burst', key: body.key, reason: 'build' })
      // Why: at a desk the work is typing; walking off to a tray between strikes read as a bug.
      go(world, body, world.layout.workSeated ? 'build' : 'fetch')
    }
  } else {
    go(world, body, 'build')
  }
}

function stepResting(world: TeamSceneWorld, body: TeamSceneBody, width: number): void {
  const { work } = body
  // Why: at a desk the rule is seated; a stroll stood the member up in front of its neighbour.
  if (world.layout.workSeated) {
    if (work.step !== 'play') {
      go(world, body, 'play')
    }
    body.target = body.home
    return
  }
  if (work.step === 'stroll') {
    if (near(body, width)) {
      go(world, body, 'pause')
    }
    return
  }
  if (work.step !== 'pause') {
    go(world, body, 'pause')
    body.target = body.home
    return
  }
  if (world.t - work.at >= PAUSE_SECONDS) {
    work.strolls += 1
    // Why the cycle: out one side, back to the seat, out the other, so it never drifts away.
    const offset = [STROLL_X, 0, -STROLL_X, 0][work.strolls % 4]!
    body.target = { x: body.home.x + offset, depth: body.home.depth }
    go(world, body, 'stroll')
  }
}

/** A seated member's own round: build and fetch while working, stroll while resting. */
export function stepTeamSceneWork(world: TeamSceneWorld, body: TeamSceneBody, width: number): void {
  if (body.activity === 'working') {
    stepWorking(world, body, width)
  } else if (body.activity === 'resting') {
    stepResting(world, body, width)
  } else {
    if (body.work.step !== 'still') {
      go(world, body, 'still')
    }
    body.target = body.home
  }
}

/** The pose a seated member's round shows; null leaves it to the seat's activity. */
export function workPoseOf(body: TeamSceneBody): 'work' | 'idle' | null {
  const { step } = body.work
  if (body.activity !== 'working') {
    return null
  }
  // Why exact: a walker snaps onto its target on arrival (moveTeamSceneBody).
  const atSeat = body.x === body.home.x
  return (step === 'build' || step === 'repair') && atSeat ? 'work' : 'idle'
}

/** A resting member's play in its desk chair; undefined anywhere else. */
export function seatedPlayOf(
  world: TeamSceneWorld,
  body: TeamSceneBody
): TeamScenePlay | undefined {
  if (
    !world.layout.workSeated ||
    body.activity !== 'resting' ||
    body.plan.kind !== 'seated' ||
    body.x !== body.home.x
  ) {
    return undefined
  }
  const row = [...world.bodies.values()]
    .filter((one) => one.role === 'member' && one.home.depth === body.home.depth)
    .sort((p, q) => p.home.x - q.home.x)
  const seat = Math.max(0, row.indexOf(body))
  // Why staggered: each seat switches a fifth of a turn after its left neighbour, so two
  // neighbours sit one or two plays apart and the row never changes all at once.
  const turn = Math.floor((world.t + ((seat % 5) * PLAY_SECONDS) / 5) / PLAY_SECONDS)
  return PLAYS[(seat + turn) % PLAYS.length]
}
