import type { TeamSceneMemberInput } from './team-scene-types'

// Why from state only: a member moves when its place changes between two reads of the team, so
// every walk has a real event behind it and nothing moves without one (owner, ORCA-1317).

/** Where a 3D Office member belongs: its desk, the lead's office, the cafeteria, the games room,
 * or out of the building. */
export type Office3dPlace = 'desk' | 'office' | 'cafe' | 'games' | 'gone'

/** Its PR is still open: CI is read only while it is, or it sits in review or the merge queue. */
const prOpen = (m: TeamSceneMemberInput): boolean =>
  m.ci !== undefined || m.desk?.kind === 'review' || m.desk?.kind === 'queue'

/**
 * The owner's table, by precedence: working is always the desk; the lead's office only for a
 * question, a decision gate or a block; a finished member waits in the cafeteria while its PR is
 * open or it is out of quota, and plays in the games room when nothing is open.
 */
export function office3dPlaceOf(m: TeamSceneMemberInput): Office3dPlace {
  if (m.away || m.hold === 'queued') {
    return 'gone'
  }
  if (m.activity === 'working') {
    return 'desk'
  }
  if ((m.activity === 'needsYou' && !m.paneAsk) || m.activity === 'blocked') {
    return 'office'
  }
  if (
    m.activity === 'needsYou' ||
    m.ci === 'failure' ||
    m.hold === 'starting' ||
    m.hold === 'loggedOut' ||
    m.hold === 'unreachable'
  ) {
    return 'desk'
  }
  if (m.hold === 'limited' || m.hold === 'asleep' || prOpen(m)) {
    return 'cafe'
  }
  return 'games'
}
