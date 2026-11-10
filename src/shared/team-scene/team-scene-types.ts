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
}

export type TeamSceneInput = {
  lead: TeamSceneAgentInput
  /** Present only with the advisor plugin. */
  advisor: { line: string | null } | null
  /** Needs-you first, as the Team model orders them. */
  members: TeamSceneMemberInput[]
}

export type TeamSceneEvent =
  | { kind: 'join'; key: string }
  | { kind: 'leave'; key: string }
  | { kind: 'handoff'; key: string }
  | { kind: 'finish'; key: string }
  | { kind: 'merge'; key: string }
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

export type TeamScenePose = 'idle' | 'work' | 'walk' | 'raise' | 'give' | 'wave' | 'cheer' | 'done'

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
}

/** One-shot moments a style may draw particles or a thrown item for. */
export type TeamSceneEffect =
  | { kind: 'handoff'; from: string; to: string }
  | {
      kind: 'burst'
      key: string
      reason: 'merge' | 'welcome' | 'goodbye' | 'finish' | 'build' | 'repair' | 'puff'
      /** Where it bursts when not where `key` stands now, as a puff where the advisor vanished. */
      at?: TeamSceneSpot
    }
