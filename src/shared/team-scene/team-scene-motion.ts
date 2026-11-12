import type { TeamSceneSpot } from './team-scene-types'

const MAX_SPEED_PX = 32

/** Shared with styles so a drawn figure's size and its stride agree. */
export const teamSceneScaleAt = (depth: number): number => 0.6 + 0.16 * depth
export const teamSceneStrideAt = (depth: number): number => 8.8 * teamSceneScaleAt(depth)

export type TeamSceneMover = {
  x: number
  depth: number
  target: TeamSceneSpot
  v: number
  facing: 1 | -1
  gait: number
  /** Its top walking speed in px/s; members and the lead walk at the default. */
  speed?: number
}

/** Eases toward the target; the gait advances by distance over stride so feet stay planted. */
export function moveTeamSceneBody(body: TeamSceneMover, dt: number, width: number): void {
  const dx = (body.target.x - body.x) * width
  const top = body.speed ?? MAX_SPEED_PX
  const want = Math.max(-top, Math.min(top, dx * 4.5))
  body.v += (want - body.v) * Math.min(1, dt * 9)
  body.x += (body.v * dt) / width
  body.depth += (body.target.depth - body.depth) * Math.min(1, dt * 2)
  if (Math.abs(body.v) > 2) {
    body.facing = body.v > 0 ? 1 : -1
  }
  body.gait += ((Math.abs(body.v) * dt) / teamSceneStrideAt(body.depth)) * Math.PI
  if (Math.abs(dx) < 1.2 && Math.abs(body.v) < 9) {
    body.v = 0
    body.x = body.target.x
  }
}

/** Close enough to count as arrived, in px so it holds at every panel width. */
export const teamSceneArrived = (body: TeamSceneMover, width: number): boolean =>
  Math.abs((body.target.x - body.x) * width) < 2 && Math.abs(body.v) < 6
