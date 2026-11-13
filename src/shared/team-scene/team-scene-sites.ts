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
  pr: 2,
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
  if (!open) {
    return { stage: phase, broken: false }
  }
  return { stage: m.pr?.ci === 'success' ? 3 : 2, broken: m.pr?.ci === 'failure' }
}

/** A build only grows: `code` lasts only while an edit tool runs, so the phase flickers. */
export const grownSite = (before: TeamSceneSite | null, now: TeamSceneSite): TeamSceneSite => {
  // Why the reset: after a merge, a lower stage is the member's next build, not a flicker.
  const keep = before && before.stage < 4 && before.stage > now.stage
  return { stage: keep ? before.stage : now.stage, broken: now.broken }
}

const MAX_TROPHIES = 6

/** Adds merged work once, dropping the oldest past what the stage has room for. */
export function keepTrophy(
  trophies: { key: string; name: string }[],
  next: { key: string; name: string }
): void {
  if (!trophies.some((t) => t.key === next.key)) {
    trophies.push(next)
    trophies.splice(0, Math.max(0, trophies.length - MAX_TROPHIES))
  }
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
