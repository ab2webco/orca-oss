import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { AdvisorLog, AdvisorLogEntry } from '../types'
import {
  advisorBubbleOf,
  advisorCuesOf,
  cueTicksOf,
  strongestCueOf,
  type AdvisorCue,
  type AdvisorDecision,
  type AdvisorSeen
} from './advisor-cues'
import { advisorOf, type Advisor } from './allies'
import type { AdvisorPose } from './scene-cast'
import type { SceneAdvisor } from './scenes/index'

// Jev's advisor in this pane: what it last published, the gesture playing, and its decisions.

const JEV_ADVISOR = { plugin: 'orca-jev-mod-skills', key: 'advisor' } as const
export const ADVISOR_LOG_MAX = 5

const EMPTY: AdvisorLog = { decisions: [] }
const advisorLog = atom({ plugin: 'orca-game', key: 'advisor' } as const, EMPTY)

type AdvisorRuntime = {
  advisor: Advisor | null
  seen: AdvisorSeen | null
  cue: { cue: AdvisorCue; at: number } | undefined
}

// Module state: a hot reload starts it over, which only takes the gesture playing.
const runtime: AdvisorRuntime = { advisor: null, seen: null, cue: undefined }

/** Notes Jev's latest value; the decisions it brings, the first value's included, go to the log. */
export function observeAdvisor(value: unknown, tick: number): AdvisorDecision[] {
  const advisor = advisorOf(value)
  runtime.advisor = advisor
  if (advisor === null) {
    // Why forget: a Jev that comes back starts from where it stands, not with a burst of gestures.
    runtime.seen = null
    runtime.cue = undefined
    return []
  }
  const next = advisorCuesOf(runtime.seen, advisor)
  runtime.seen = next.seen
  const cue = strongestCueOf(next.cues)
  if (cue !== undefined) {
    runtime.cue = { cue, at: tick }
  }
  return next.decisions
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

/** The advisor as the scene draws it at `tick`; none while Jev publishes nothing readable. */
export const advisorPoseAt = (
  tick: number,
  sprite: SceneAdvisor,
  isZen: boolean
): AdvisorPose | undefined => {
  if (runtime.advisor === null) {
    return undefined
  }
  const playing = runtime.cue
  const age = playing === undefined ? 0 : tick - playing.at
  if (playing === undefined || age < 0 || age >= cueTicksOf(playing.cue.gesture)) {
    return { sprite, age: 0, bubble: '' }
  }
  return { sprite, gesture: playing.cue.gesture, age, bubble: advisorBubbleOf(playing.cue, isZen) }
}

const playingAt = (tick: number): AdvisorCue | undefined => {
  const playing = runtime.cue
  const age = playing === undefined ? -1 : tick - playing.at
  return playing !== undefined &&
    runtime.advisor !== null &&
    age >= 0 &&
    age < cueTicksOf(playing.cue.gesture)
    ? playing.cue
    : undefined
}

/** A gesture plays at `tick` worth showing the scene for; zen keeps the routine ones quiet. */
export const isAdvisorActingAt = (tick: number, isZen: boolean): boolean => {
  const cue = playingAt(tick)
  return cue !== undefined && !(isZen && cue.isRoutine)
}

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
