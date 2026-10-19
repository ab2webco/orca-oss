import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { AdvisorLog, AdvisorLogEntry } from '../types'
import {
  advisorCallAfter,
  advisorCallRowOf,
  advisorPoseOf,
  isAdvisorActingOf,
  isAdvisorCallCue,
  type AdvisorCall,
  type AdvisorScene,
  type StoredRow
} from './advisor-calls'
import {
  advisorCuesOf,
  cueTicksOf,
  playingCueOf,
  strongestCueOf,
  type AdvisorCue,
  type AdvisorDecision,
  type AdvisorSeen,
  type PlayingCue
} from './advisor-cues'
import { advisorOf, type Advisor } from './allies'
import type { AdvisorPose } from './scene-cast'
import type { SceneAdvisor } from './scenes/index'

// Jev's advisor in this pane: what it last published, the gesture playing, its decisions, and Claude's open advisor call.

const JEV_ADVISOR = { plugin: 'orca-jev-mod-skills', key: 'advisor' } as const
export const ADVISOR_LOG_MAX = 5

const EMPTY: AdvisorLog = { decisions: [] }
const advisorLog = atom({ plugin: 'orca-game', key: 'advisor' } as const, EMPTY)

type AdvisorRuntime = {
  advisor: Advisor | null
  seen: AdvisorSeen | null
  cue: PlayingCue | undefined
  call: AdvisorCall | undefined
}

// Module state: a hot reload starts it over, which only takes the gesture playing.
const runtime: AdvisorRuntime = { advisor: null, seen: null, cue: undefined, call: undefined }

/** Notes Jev's latest value; the decisions it brings, the first value's included, go to the log. */
export function observeAdvisor(value: unknown, tick: number): AdvisorDecision[] {
  const advisor = advisorOf(value)
  runtime.advisor = advisor
  if (advisor === null) {
    // Why forget: a Jev that comes back starts from where it stands, not with a burst of gestures.
    runtime.seen = null
    // Why keep a call's cue: every render reads Jev, and without Jev a reaction would be wiped as it starts.
    if (runtime.cue !== undefined && !isAdvisorCallCue(runtime.cue.cue)) {
      runtime.cue = undefined
    }
    return []
  }
  const next = advisorCuesOf(runtime.seen, advisor)
  runtime.seen = next.seen
  const cue = strongestCueOf(next.cues)
  if (cue !== undefined) {
    playAdvisorCue(cue, tick)
  }
  return next.decisions
}

/** Plays `cue` from `tick` unless a stronger gesture is still playing; any source of cues comes here. */
export const playAdvisorCue = (cue: AdvisorCue, tick: number): void => {
  runtime.cue = playingCueOf(runtime.cue, cue, tick)
}

/** Jev's value as this pane reads it; a drawing that calls this redraws on Jev's writes. */
export async function readJevAdvisor($: EngineInterface, tick: number): Promise<Advisor | null> {
  const held = await $.state.get(JEV_ADVISOR).catch(() => ({ value: undefined }))
  const advisor = advisorOf(held.value)
  // Why no gesture here: a drawing may read a value older than the write just acted out.
  if (advisor === null || runtime.seen === null) {
    observeAdvisor(held.value, tick)
  }
  runtime.advisor = advisor
  return advisor
}

export const advisorNow = (): Advisor | null => runtime.advisor

/** Notes a row the session keeps; true when it opened or closed Claude's advisor call. */
export function noteAdvisorRow(row: StoredRow, tick: number): boolean {
  const next = advisorCallAfter(runtime.call, advisorCallRowOf(row), tick)
  if (next.call === runtime.call && next.cue === undefined) {
    return false
  }
  runtime.call = next.call
  if (next.cue !== undefined) {
    playAdvisorCue(next.cue, tick)
  }
  return true
}

/** Forgets an open call whose result never came: the turn ended, aborted or failed. */
export function dropAdvisorCall(): boolean {
  const wasOpen = runtime.call !== undefined
  runtime.call = undefined
  return wasOpen
}

const sceneOf = (isAbsorbing: boolean): AdvisorScene => ({
  isJevShown: isAbsorbing && runtime.advisor !== null,
  call: runtime.call,
  playing: runtime.cue
})

/** The advisor as the scene draws it at `tick`: Jev's while the game draws its lines, and Claude's calls. */
export const advisorPoseAt = (
  tick: number,
  sprite: SceneAdvisor,
  isZen: boolean,
  isAbsorbing: boolean
): AdvisorPose | undefined => advisorPoseOf(sceneOf(isAbsorbing), tick, sprite, isZen)

/** A gesture plays at `tick` worth showing the scene for; zen keeps the routine ones quiet. */
export const isAdvisorActingAt = (tick: number, isZen: boolean, isAbsorbing: boolean): boolean =>
  isAdvisorActingOf(sceneOf(isAbsorbing), tick, isZen)

export const isAdvisorCueEndingAt = (tick: number): boolean =>
  runtime.cue !== undefined && tick - runtime.cue.at === cueTicksOf(runtime.cue.cue.gesture)

const entryOf = (decision: AdvisorDecision, at: number): AdvisorLogEntry => ({ ...decision, at })

export async function logDecisions(
  $: EngineInterface,
  decisions: readonly AdvisorDecision[],
  at: number
): Promise<void> {
  if (decisions.length === 0) {
    return
  }
  await update($, advisorLog, (held) => {
    const fresh = decisions.map((one) => entryOf(one, at))
    const keys = new Set(fresh.map((one) => one.key))
    const kept = (held?.decisions ?? []).filter((one) => !keys.has(one.key))
    return { decisions: [...kept, ...fresh].slice(-ADVISOR_LOG_MAX) }
  }).catch(() => undefined)
}

export async function advisorLogOf($: EngineInterface): Promise<AdvisorLog> {
  return read($, advisorLog).catch(() => EMPTY)
}
