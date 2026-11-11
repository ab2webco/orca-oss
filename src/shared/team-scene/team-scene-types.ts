import type { TeamSceneRide } from './team-scene-elevator'
import type { TeamSceneDesk } from './team-scene-desk'
import type { TeamSceneSite } from './team-scene-sites'

// Why: the scene reads a narrow projection of the Team model (ORCA-1049) so every style and
// client (desktop canvas, later mobile) runs the same simulation from real state only.

/** What a seated agent does: work, rest, stop for the user, stand finished, or wait unable to work. */
export type TeamSceneActivity = 'working' | 'resting' | 'needsYou' | 'done' | 'blocked'

export type TeamSceneAgentInput = {
  key: string
  name: string
  /** The persistent game character (ORCA-1034); null draws the style's default. */
  characterKey: string | null
  activity: TeamSceneActivity
  /** Jev's latest decisions in this pane, newest last; absent when its Jev sent none. */
  decisions?: { id: string; verdict: string; gesture: string | null }[]
}

export type TeamSceneMemberInput = TeamSceneAgentInput & {
  /** Changes when the member files a new report; each change is one hand-off to the lead. */
  reportId: string | null
  /** The member's merged PR number; a new one is one celebration. */
  mergedPr: number | null
  /** Its visible build, staged from its real phase, PR and CI. */
  site: TeamSceneSite
  /** Its session is gone or never started: the seat stays, with nobody in it. */
  away?: true
  /** What its monitor shows while it works, from its card; absent is plain code. */
  desk?: TeamSceneDesk
  /** Why it cannot work yet or now, from its card's condition. */
  hold?: TeamSceneHold
  /** Its open PR's CI reading; absent with no open PR or no reading. */
  ci?: 'pending' | 'failure' | 'success'
}

export type TeamSceneInput = {
  lead: TeamSceneAgentInput
  /** Present only with the advisor plugin. */
  advisor: { line: string | null } | null
  /** Needs-you first, as the Team model orders them. */
  members: TeamSceneMemberInput[]
  /** The project's launch STOP is set; it does not stop the members it left running. */
  stopped?: true
  /** A floor of the building the lead does not stand on: no lead, and nobody walks to one. */
  leadless?: true
  /** Empty desks after the members': other sessions' (taken, drawn dim) and the cap's free ones. */
  desks?: { taken: number; free: number }
  /** A building floor: on a narrow stage the lead keeps to its own spot instead of its rounds. */
  leadStays?: true
  /** The lead riding to another floor, or visiting a member of this one from another. */
  ride?: TeamSceneRide
  /** The advisor rode here from the lead's floor for a Jev decision, so it comes in by the elevator. */
  advisorEnters?: true
}

export type TeamSceneEvent =
  | { kind: 'join'; key: string }
  | { kind: 'leave'; key: string }
  | { kind: 'handoff'; key: string }
  | { kind: 'finish'; key: string }
  | { kind: 'merge'; key: string }
  /** An open PR's CI turned green from running or red. */
  | { kind: 'ciGreen'; key: string }
  | { kind: 'advisorSpoke'; line: string }
  /** Jev decided in `key`'s pane ('lead' for the lead); the advisor walks over and gestures. */
  | { kind: 'judged'; key: string; gesture: TeamSceneGesture }

/** What the advisor shows for a Jev decision, as the game's gestures name them. */
export type TeamSceneGesture =
  | 'lowered'
  | 'raised'
  | 'approved'
  | 'unsure'
  | 'escalated'
  | 'ciRunning'
  | 'ciPassed'
  | 'ciFailed'
  | 'stopped'
  | 'consulting'
  | 'advised'

/** A point on stage: x across the width (0 to 1), depth from back (0) to front (1). */
export type TeamSceneSpot = { x: number; depth: number }

/** A desk's spot; `taken` is another session's, with nobody of this team at it. */
export type TeamSceneStation = TeamSceneSpot & { taken?: true }

export type TeamScenePose = 'idle' | 'work' | 'walk' | 'raise' | 'give' | 'wave' | 'cheer' | 'done'

/** What an idle member does in its chair at a desk, so a resting row never looks frozen. */
export type TeamScenePlay = 'music' | 'sketch' | 'plane' | 'game'

/** Why a member is not working, as its card's condition says; a style may draw each its own way. */
export type TeamSceneHold =
  | 'limited'
  | 'asleep'
  | 'loggedOut'
  | 'unreachable'
  | 'queued'
  | 'starting'

export type TeamSceneEmote = 'alert' | 'check' | 'star' | 'heart' | 'blocked'

export type TeamSceneActor = {
  key: string
  role: 'lead' | 'member' | 'advisor'
  name: string
  characterKey: string | null
  x: number
  depth: number
  /** 1 faces right, -1 faces left; styles draw a true side profile. */
  facing: 1 | -1
  pose: TeamScenePose
  /** Walk cycle angle; it advances by distance over stride, so feet do not slide. */
  gait: number
  /** Stride length in px at this depth, the unit the gait is measured in. */
  stride: number
  carrying: boolean
  emote: TeamSceneEmote | null
  /** Hop height in px while cheering. */
  jump: number
  /** The advisor's gesture for a Jev decision while it stands by the judged pane. */
  gesture?: TeamSceneGesture | null
  /** A resting member's play in its chair, only where members work seated. */
  play?: TeamScenePlay
  /** A member whose session is gone or never started; a style may leave its seat empty. */
  away?: true
  /** What a working member's monitor shows; a style without monitors ignores it. */
  desk?: TeamSceneDesk
  /** Why the member cannot work; a style without desks keeps its blocked mark. */
  hold?: TeamSceneHold
}

/** One-shot moments a style may draw particles or a thrown item for. */
export type TeamSceneEffect =
  | { kind: 'handoff'; from: string; to: string }
  /** A member's CI just turned green; a style with monitors flashes that one. */
  | { kind: 'ciGreen'; key: string }
  | {
      kind: 'burst'
      key: string
      reason: 'merge' | 'welcome' | 'goodbye' | 'finish' | 'build' | 'repair' | 'puff'
      /** Where it bursts when not where `key` stands now, as a puff where the advisor vanished. */
      at?: TeamSceneSpot
    }
