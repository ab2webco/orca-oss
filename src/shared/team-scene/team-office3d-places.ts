import type { TeamSceneMemberInput } from './team-scene-types'

// Why from state only: a member moves when its place changes between two reads of the team, so
// every walk has a real event behind it and nothing moves without one (owner, ORCA-1317).

/** Where a 3D Office member belongs: its desk, the lead's office, the cafeteria, the games room,
 * or out of the building. */
export type Office3dPlace = 'desk' | 'office' | 'cafe' | 'games' | 'gone'

/** Where a member waits on its open PR (CI running, review, queue): picked once per wait. */
export type Office3dWait = 'desk' | 'cafe' | 'games'

/** Its PR is still open: CI is read only while it is, or it sits in review or the merge queue. */
export const office3dPrOpen = (m: TeamSceneMemberInput): boolean =>
  m.ci !== undefined || m.desk?.kind === 'review' || m.desk?.kind === 'queue'

const WAITS: readonly Office3dWait[] = ['desk', 'cafe', 'games']

/**
 * The owner: 'unos se quedan y otros esperan'. Seeded by the member and the wait, so the pick
 * holds for that whole wait and the office does not move in unison; the same inputs give the
 * same pick, which keeps tests deterministic.
 */
export function office3dWaitOf(key: string, waitId: string): Office3dWait {
  let h = 2166136261
  for (const ch of `${key}|${waitId}`) {
    h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  }
  return WAITS[(h >>> 0) % WAITS.length]!
}

/**
 * The owner's table, by precedence: working is always the desk; the lead's office only for an
 * Inbox question or decision gate; red CI back at the desk; out of quota in the cafeteria; an open
 * PR waits where `wait` picked; merged or with nothing to do it is available in the games room.
 */
export function office3dPlaceOf(m: TeamSceneMemberInput, wait: Office3dWait): Office3dPlace {
  if (m.away || m.hold === 'queued') {
    return 'gone'
  }
  if (m.activity === 'working') {
    return 'desk'
  }
  if (m.activity === 'needsYou') {
    // A permission prompt is answered in its own pane, at its own desk.
    return m.paneAsk ? 'desk' : 'office'
  }
  if (m.hold === 'limited' || m.hold === 'asleep') {
    return 'cafe'
  }
  // Why the desk: 'blocked' is the scene's can't-run catch-all (paused, failed start, logged out,
  // unreachable), never a problem for the lead, and red CI is fixed at the desk.
  if (m.activity === 'blocked' || m.hold || m.ci === 'failure') {
    return 'desk'
  }
  return office3dPrOpen(m) ? wait : 'games'
}
