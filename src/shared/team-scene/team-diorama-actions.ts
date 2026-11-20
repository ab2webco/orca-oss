import type { TeamSceneMemberInput } from './team-scene-types'

// Why from real state only: every plot and pose here comes from the member's activity, hold, site
// and CI, never from a timer (owner's rule, 2026-11-10; ORCA-1296).

/** What a member does at its plot in the Figures diorama. */
export type DioramaAction =
  | 'build' // working: hammers at its build
  | 'inspect' // CI running: waits by a lit scaffold
  | 'wait' // PR open or in the queue: waits by its finished build, flag up
  | 'signal' // needs you: stops and waves under the signal; the lead comes
  | 'repair' // CI red: the roof burns and it repairs
  | 'cheer' // merged: celebrates, then its build stays as a trophy
  | 'rest' // limited, asleep or logged out: rests at the camp
  | 'start' // queued or starting: comes out of the keep to its plot
  | 'idle' // free: fishes, farms or chops wood
  | 'gone' // its session is gone: the plot keeps its build, empty

export type DioramaIdlePlay = 'fish' | 'farm' | 'chop'

export type DioramaPlotView = {
  action: DioramaAction
  /** 0 staked, 1 foundation, 2 frame, 3 walls, 4 roofed. */
  stage: 0 | 1 | 2 | 3 | 4
  fire: boolean
  scaffold: 'wood' | 'lit' | null
  flag: 'pr' | 'merged' | null
  play: DioramaIdlePlay | null
}

const STAGE_OF_SITE: Record<TeamSceneMemberInput['site']['stage'], DioramaPlotView['stage']> = {
  0: 1,
  1: 2,
  2: 3,
  3: 3,
  4: 4
}
const PLAYS: DioramaIdlePlay[] = ['fish', 'farm', 'chop']

/** Its action first by what needs the user, then what breaks, then the work's own progress. */
export function dioramaActionOf(m: TeamSceneMemberInput): DioramaAction {
  if (m.away) {
    return 'gone'
  }
  if (m.activity === 'needsYou') {
    return 'signal'
  }
  if (m.hold === 'queued' || m.hold === 'starting') {
    return 'start'
  }
  if (m.activity === 'blocked') {
    return m.hold === 'unreachable' ? 'gone' : 'rest'
  }
  if (m.site.broken || m.ci === 'failure') {
    return 'repair'
  }
  if (m.mergedPr !== null || m.site.stage === 4) {
    return 'cheer'
  }
  if (m.ci === 'pending') {
    return 'inspect'
  }
  if (m.site.stage === 3 || m.ci === 'success' || m.desk?.kind === 'queue') {
    return 'wait'
  }
  return m.activity === 'working' ? 'build' : 'idle'
}

/**
 * The plot as the diorama draws it. `idleIndex` spreads the free members over fishing, farming
 * and chopping, by their place among the free ones, so the choice stays put between reads.
 */
export function dioramaPlotViewOf(m: TeamSceneMemberInput, idleIndex = 0): DioramaPlotView {
  const action = dioramaActionOf(m)
  const stage = STAGE_OF_SITE[m.site.stage]
  return {
    action,
    stage,
    fire: action === 'repair',
    scaffold: action === 'inspect' ? 'lit' : action === 'build' && stage <= 3 ? 'wood' : null,
    flag: action === 'cheer' ? 'merged' : action === 'wait' ? 'pr' : null,
    play: action === 'idle' ? PLAYS[idleIndex % PLAYS.length]! : null
  }
}
