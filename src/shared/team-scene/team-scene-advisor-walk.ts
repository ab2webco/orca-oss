import type { TeamSceneBody, TeamSceneWorld } from './team-scene-director'
import { teamSceneArrived as near } from './team-scene-motion'
import type { TeamSceneGesture } from './team-scene-types'

// How long the advisor holds a gesture beside the pane Jev judged.
const GESTURE_SECONDS = 2.4
// Why a few: decisions ride a 30 s poll, so an older one waiting longer is no longer news.
const QUEUE_MAX = 3
const BESIDE_X = 0.06
const BEHIND = 0.08

/** The advisor's own walks to the panes Jev judges, apart from the lead's queue of visits. */
export type TeamSceneAdvisorWalk = {
  stage: 'home' | 'out' | 'gesture' | 'back'
  queue: { key: string; gesture: TeamSceneGesture }[]
  key: string | null
  gesture: TeamSceneGesture | null
  at: number
}

export const createAdvisorWalk = (): TeamSceneAdvisorWalk => ({
  stage: 'home',
  queue: [],
  key: null,
  gesture: null,
  at: 0
})

export function queueJudgment(world: TeamSceneWorld, key: string, gesture: TeamSceneGesture): void {
  if (!world.bodies.has('advisor')) {
    return
  }
  const { queue } = world.advisorWalk
  queue.push({ key, gesture })
  queue.splice(0, Math.max(0, queue.length - QUEUE_MAX))
}

// Why the side away from the lead: at the same member, the lead would hide the advisor's gesture.
const besideOf = (target: TeamSceneBody, lead: TeamSceneBody | undefined) => {
  const side = lead && lead.x > target.x ? -1 : 1
  return { x: target.x + side * BESIDE_X, depth: Math.max(0, target.depth - BEHIND) }
}

/** One step of the advisor's walk out to a judged pane, its gesture there, and its walk home. */
export function stepAdvisorWalk(world: TeamSceneWorld, width: number): void {
  const advisor = world.bodies.get('advisor')
  const walk = world.advisorWalk
  if (!advisor) {
    Object.assign(walk, createAdvisorWalk())
    return
  }
  const target = walk.key ? world.bodies.get(walk.key) : undefined
  if (walk.stage === 'home') {
    advisor.target = advisor.home
    const next = near(advisor, width) ? walk.queue.shift() : undefined
    if (next && world.bodies.has(next.key)) {
      Object.assign(walk, { stage: 'out', key: next.key, gesture: next.gesture })
    }
  } else if (walk.stage === 'out') {
    if (!target) {
      Object.assign(walk, { stage: 'back', key: null, gesture: null })
      return
    }
    advisor.target = besideOf(target, walk.key === 'lead' ? undefined : world.bodies.get('lead'))
    if (near(advisor, width)) {
      Object.assign(walk, { stage: 'gesture', at: world.t })
    }
  } else if (walk.stage === 'gesture') {
    advisor.facing = target && target.x < advisor.x ? -1 : 1
    if (!target || world.t - walk.at >= GESTURE_SECONDS) {
      Object.assign(walk, { stage: 'back', key: null, gesture: null })
    }
  } else {
    advisor.target = advisor.home
    if (near(advisor, width)) {
      walk.stage = 'home'
      advisor.facing = -1
    }
  }
}

/** The gesture the advisor holds up this frame, for styles to draw beside it. */
export const advisorGestureOf = (world: TeamSceneWorld): TeamSceneGesture | null =>
  world.advisorWalk.stage === 'gesture' ? world.advisorWalk.gesture : null
