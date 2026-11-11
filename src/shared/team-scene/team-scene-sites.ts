import type { TeamFlowPhase, TeamPullRequest } from '../team-panel-model-types'
import type { TeamSceneSpot } from './team-scene-types'

/** 0 foundation, 1 walls, 2 scaffold, 3 nearly done, 4 finished: each style draws its own build. */
export type TeamSceneSiteStage = 0 | 1 | 2 | 3 | 4

/** A member's visible project; `broken` while its open PR has red CI. */
export type TeamSceneSite = { stage: TeamSceneSiteStage; broken: boolean }

export type TeamSceneSiteView = TeamSceneSite & { key: string; spot: TeamSceneSpot }

const PHASE_STAGE: Record<TeamFlowPhase, TeamSceneSiteStage> = {
  plan: 0,
  docs: 0,
  code: 1,
  tests: 2,
  pr: 3,
  merge: 3
}

// Why real state only: the build must say how far the member really is, never a timer.
export function teamSceneSiteOf(m: {
  flowPhase: TeamFlowPhase | null
  pr: TeamPullRequest | null
}): TeamSceneSite {
  if (m.pr?.state === 'merged') {
    return { stage: 4, broken: false }
  }
  const open = m.pr?.state === 'open' || m.pr?.state === 'draft'
  const phase = m.flowPhase ? PHASE_STAGE[m.flowPhase] : 0
  return { stage: open ? 3 : phase, broken: open && m.pr?.ci === 'failure' }
}

// Why these offsets: a column is 0.16 wide, so the pile and the site stay inside the seat's own.
export const SITE_FROM_SEAT_X = 0.055
export const PILE_FROM_SEAT_X = 0.06
export const siteSpotOf = (home: TeamSceneSpot): TeamSceneSpot => ({
  x: home.x + SITE_FROM_SEAT_X,
  depth: home.depth
})
export const pileSpotOf = (home: TeamSceneSpot): TeamSceneSpot => ({
  x: home.x - PILE_FROM_SEAT_X,
  depth: home.depth
})
