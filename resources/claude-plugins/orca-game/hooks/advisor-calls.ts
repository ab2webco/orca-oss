import { advisorBubbleOf, cueTicksOf, type AdvisorCue, type PlayingCue } from './advisor-cues'
import { gameStrings } from './game-strings'
import type { AdvisorPose } from './scene-cast'
import type { AdvisorGesture, SceneAdvisor } from './scenes/index'

// Claude's own advisor tool, as the session keeps it: a server_tool_use row, then its result row minutes later.

/** The open call and the tick its row arrived on. */
export type AdvisorCall = { id: string; at: number }

export type StoredBlock = { type: string; [field: string]: unknown }
export type StoredRow = { type: string; content: readonly StoredBlock[] }

export type AdvisorCallRow = { opened: string | undefined; closed: string | undefined }

const CALL_GESTURES: ReadonlySet<AdvisorGesture> = new Set(['consulting', 'advised'])

/** A cue Claude's advisor call played, not one of Jev's. */
export const isAdvisorCallCue = (cue: AdvisorCue): boolean => CALL_GESTURES.has(cue.gesture)

const idOf = (block: StoredBlock, field: 'id' | 'tool_use_id'): string | undefined => {
  const value = block[field]
  return typeof value === 'string' ? value : undefined
}

/** The advisor call a row opens or closes; the result is matched by id, never by its content's shape. */
export const advisorCallRowOf = (row: StoredRow): AdvisorCallRow => {
  const opened = row.content.find(
    (block) => block.type === 'server_tool_use' && block.name === 'advisor'
  )
  const closed = row.content.find((block) => block.type === 'advisor_tool_result')
  return {
    opened: opened === undefined ? undefined : idOf(opened, 'id'),
    closed: closed === undefined ? undefined : idOf(closed, 'tool_use_id')
  }
}

const consultingCue = (): AdvisorCue => ({
  gesture: 'consulting',
  text: gameStrings().art.advisorConsulting,
  isRoutine: false
})

/** The open call after `row`, and the cue it plays: the call coming in, or the advice coming back. */
export const advisorCallAfter = (
  call: AdvisorCall | undefined,
  row: AdvisorCallRow,
  tick: number
): { call: AdvisorCall | undefined; cue: AdvisorCue | undefined } => {
  if (row.opened !== undefined) {
    return { call: { id: row.opened, at: tick }, cue: consultingCue() }
  }
  if (row.closed !== undefined && row.closed === call?.id) {
    const advised = { gesture: 'advised' as const, text: gameStrings().art.advisorAdvised }
    return { call: undefined, cue: { ...advised, isRoutine: false } }
  }
  return { call, cue: undefined }
}

/** What the scene's advisor slot holds: whether Jev's advisor is drawn, the open call, the cue playing. */
export type AdvisorScene = {
  isJevShown: boolean
  call: AdvisorCall | undefined
  playing: PlayingCue | undefined
}

// Why a call cue shows without Jev but Jev's own cues do not: the call is Claude's, not Jev's to draw.
const shownCueOf = (scene: AdvisorScene, tick: number): PlayingCue | undefined => {
  const playing = scene.playing
  const age = playing === undefined ? -1 : tick - playing.at
  return playing !== undefined &&
    age >= 0 &&
    age < cueTicksOf(playing.cue.gesture) &&
    (scene.isJevShown || isAdvisorCallCue(playing.cue))
    ? playing
    : undefined
}

/** The advisor as the scene draws it at `tick`; none while neither Jev nor a call puts it there. */
export const advisorPoseOf = (
  scene: AdvisorScene,
  tick: number,
  sprite: SceneAdvisor,
  isZen: boolean
): AdvisorPose | undefined => {
  const shown = shownCueOf(scene, tick)
  if (shown !== undefined) {
    const bubble = advisorBubbleOf(shown.cue, isZen)
    return { sprite, gesture: shown.cue.gesture, age: tick - shown.at, bubble }
  }
  if (scene.call !== undefined) {
    const bubble = advisorBubbleOf(consultingCue(), isZen)
    return { sprite, gesture: 'consulting', age: tick - scene.call.at, bubble }
  }
  return scene.isJevShown ? { sprite, age: 0, bubble: '' } : undefined
}

/** A gesture plays at `tick` worth showing the scene for; zen keeps the routine ones quiet. */
export const isAdvisorActingOf = (scene: AdvisorScene, tick: number, isZen: boolean): boolean => {
  const shown = shownCueOf(scene, tick)
  return scene.call !== undefined || (shown !== undefined && !(isZen && shown.cue.isRoutine))
}
