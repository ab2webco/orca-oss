import type { TeamSceneDesk } from './team-scene-desk'
import type {
  TeamSceneEmote,
  TeamSceneHold,
  TeamSceneMemberInput,
  TeamScenePlay
} from './team-scene-types'
import { seatedPlayAt } from './team-scene-work-loop'

// Why from real state only, as the 2D Office: a desk's pose, screen and mark come from the
// member's activity, hold, desk, site and CI, never from a timer (ORCA-1302).

/** How a seated developer holds itself at its desk. */
export type Office3dPose = 'type' | 'raise' | 'done' | 'slump' | 'rest' | 'idle'

/** What its monitor shows: the card's desk, a hold's own screen, plain code, or nothing. */
export type Office3dScreen =
  | { kind: 'code' }
  | { kind: 'desk'; desk: TeamSceneDesk }
  | { kind: 'hold'; hold: TeamSceneHold }
  | { kind: 'idle' }
  | { kind: 'off' }

export type Office3dSeatView = {
  pose: Office3dPose
  screen: Office3dScreen
  /** The red-CI bug on its screen and the desk's shake, until CI is green. */
  virus: boolean
  /** The mark over its head, in Orca's status colours. */
  mark: TeamSceneEmote | null
  /** Its chair is empty: the session is gone, or its launch waits for a slot. */
  empty: boolean
  /** Drawn see-through: its machine cannot be reached. */
  faded: boolean
  /** The task board's stage over the desk, as the 2D Office's board. */
  board: TeamSceneMemberInput['site']
}

/** A held member's pose: at its limit or asleep it slumps; the rest just sit. */
const HOLD_POSE: Record<TeamSceneHold, Office3dPose> = {
  limited: 'slump',
  asleep: 'slump',
  loggedOut: 'idle',
  unreachable: 'idle',
  queued: 'idle',
  starting: 'idle'
}

// Why no cheer or star here: as in the 2D Office, a merge is a moment (the walkers' event), not a
// state, so a merged member sits finished once the celebration is over.
function poseOf(m: TeamSceneMemberInput): Office3dPose {
  if (m.activity === 'needsYou') {
    return 'raise'
  }
  if (m.hold) {
    return HOLD_POSE[m.hold]
  }
  if (m.activity === 'blocked') {
    return 'slump'
  }
  if (m.activity === 'done') {
    return 'done'
  }
  return m.activity === 'working' ? 'type' : 'rest'
}

function screenOf(m: TeamSceneMemberInput, empty: boolean): Office3dScreen {
  if (empty && m.hold !== 'queued') {
    return { kind: 'off' }
  }
  if (m.hold) {
    return { kind: 'hold', hold: m.hold }
  }
  if (m.desk) {
    return { kind: 'desk', desk: m.desk }
  }
  return m.activity === 'resting' ? { kind: 'idle' } : { kind: 'code' }
}

/** The 2D Office's seated marks: needs you (a prompt in its own pane, or an Inbox question),
 * finished, blocked; a logged-out session shows blocked like its card. */
function markOf(m: TeamSceneMemberInput): TeamSceneEmote | null {
  if (m.activity === 'needsYou') {
    return m.paneAsk ? 'prompt' : 'alert'
  }
  if (m.hold === 'unreachable') {
    return null
  }
  if (m.activity === 'done') {
    return 'check'
  }
  return m.activity === 'blocked' || m.hold === 'loggedOut' ? 'blocked' : null
}

/** One member's desk as the 3D Office draws it; `reachable` is its machine's. */
export function office3dSeatViewOf(m: TeamSceneMemberInput, reachable = true): Office3dSeatView {
  const empty = m.away === true || m.hold === 'queued'
  const faded = !reachable || m.hold === 'unreachable'
  return {
    pose: poseOf(m),
    screen: faded && !empty ? { kind: 'hold', hold: 'unreachable' } : screenOf(m, empty),
    virus: !empty && !faded && (m.site.broken || m.ci === 'failure'),
    mark: empty || faded ? null : markOf(m),
    empty,
    faded,
    board: m.site
  }
}

/** A resting member's play at its desk, rotated along the row as the 2D Office does. */
export function office3dPlayOf(
  view: Office3dSeatView,
  seat: number,
  t: number
): TeamScenePlay | null {
  return view.pose === 'rest' && !view.empty && !view.faded ? seatedPlayAt(seat, t) : null
}
