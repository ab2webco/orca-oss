import type { Advisor, AdvisorAgent } from './allies'
import { isRasterText } from './game-strings'
import type { AdvisorGesture } from './scenes/index'

// Which of Jev's changes the advisor acts out: a new decision, CI state, escalation or gate verdict, never a redraw.

export type AdvisorCue = { gesture: AdvisorGesture; text: string; isRoutine: boolean }

/** The cue the advisor plays and the tick it started on. */
export type PlayingCue = { cue: AdvisorCue; at: number }

/** One decision for the Panel: a subagent's, or the main conversation's when `id` is null. */
export type AdvisorDecision = {
  key: string
  id: string | null
  title: string | null
  model: string | null
  effort: string | number | null
  verdict: string
  gesture: AdvisorGesture | null
}

/** What was already acted out, kept across values; a value whose keys are all here plays nothing. */
export type AdvisorSeen = { keys: ReadonlySet<string>; main: string }

// Why bounded: a long session must not grow it forever; the oldest keys are long gone from Jev.
const SEEN_MAX = 256

const WHY_GESTURES: Readonly<Record<string, AdvisorGesture>> = {
  lowered: 'lowered',
  raised: 'raised',
  chosen: 'approved',
  same: 'approved',
  explicit: 'approved',
  inherited: 'approved',
  'kept-unsure': 'unsure',
  measuring: 'unsure'
}
// Why only these: the owner asked zen to keep quiet about the decisions Jev makes on every launch.
const ROUTINE_WHYS: ReadonlySet<string> = new Set(['chosen', 'same'])

const CI_GESTURES = {
  watching: 'ciRunning',
  success: 'ciPassed',
  failure: 'ciFailed'
} as const satisfies Readonly<Record<Advisor['ci'][number]['status'], AdvisorGesture>>

const RANK: Readonly<Record<AdvisorGesture, number>> = {
  escalated: 7,
  stopped: 6,
  ciFailed: 6,
  ciPassed: 5,
  lowered: 4,
  raised: 4,
  unsure: 3,
  advised: 3,
  ciRunning: 2,
  consulting: 2,
  approved: 1
}

/** How long a gesture plays before the advisor goes idle; a red card's whistle is long. */
export const cueTicksOf = (gesture: AdvisorGesture): number => (gesture === 'escalated' ? 64 : 40)

const effortText = (effort: string | number | null): string =>
  effort === null ? '' : String(effort)

const modelEffortOf = (model: string | null, effort: string | number | null): string =>
  [model ?? '', effortText(effort)].filter((one) => one !== '').join('·')

const agentKeyOf = (agent: AdvisorAgent): string =>
  [agent.id, agent.why, agent.model, agent.effort].map(String).join('|')

export const decisionOf = (agent: AdvisorAgent): AdvisorDecision => ({
  key: agentKeyOf(agent),
  id: agent.id,
  title: agent.title,
  model: agent.model,
  effort: agent.effort,
  verdict: agent.verdict,
  gesture: agent.why === null ? null : (WHY_GESTURES[agent.why] ?? null)
})

export function advisorCuesOf(
  seen: AdvisorSeen | null,
  advisor: Advisor
): { seen: AdvisorSeen; cues: AdvisorCue[]; decisions: AdvisorDecision[] } {
  const main = modelEffortOf(advisor.model, advisor.effort)
  const agents = advisor.subagents.map((agent) => ({ agent, key: agentKeyOf(agent) }))
  const runs = advisor.ci.map((one) => ({ run: one, key: `ci|${one.id}|${one.status}` }))
  const blocks = advisor.notices
    .filter((one) => one.level === 'block')
    .map((one) => ({ notice: one, key: `notice|${one.id}` }))
  const current = [...agents, ...runs, ...blocks].map((one) => one.key)
  const keys = new Set([...(seen?.keys ?? []), ...current].slice(-SEEN_MAX))
  if (seen === null) {
    return { seen: { keys, main }, cues: [], decisions: advisor.subagents.map(decisionOf) }
  }
  const isNew = (key: string) => !seen.keys.has(key)
  const freshAgents = agents.filter((one) => isNew(one.key)).map((one) => one.agent)
  // Why: a fresh subagent on the new model is the decision; a main row beside it names the wrong agent.
  const isMainNew =
    main !== seen.main &&
    main !== '' &&
    !freshAgents.some((agent) => agent.model !== null && agent.model === advisor.model)
  const decisions: AdvisorDecision[] = [
    ...(isMainNew
      ? [
          {
            key: `main|${main}`,
            id: null,
            title: null,
            model: advisor.model,
            effort: advisor.effort,
            verdict: '',
            gesture: 'approved' as const
          }
        ]
      : []),
    ...freshAgents.map(decisionOf)
  ]
  const cues: AdvisorCue[] = [
    ...(isMainNew ? [{ gesture: 'approved' as const, text: main, isRoutine: false }] : []),
    ...freshAgents.flatMap((agent): AdvisorCue[] => {
      const gesture = agent.why === null ? undefined : WHY_GESTURES[agent.why]
      const text = [agent.model ?? '', agent.verdict].filter((one) => one !== '').join(' · ')
      const isRoutine = agent.why !== null && ROUTINE_WHYS.has(agent.why)
      return gesture === undefined ? [] : [{ gesture, text, isRoutine }]
    }),
    ...runs
      .filter((one) => isNew(one.key))
      .map((one) => ({
        gesture: CI_GESTURES[one.run.status],
        text: one.run.text,
        isRoutine: false
      })),
    ...blocks
      .filter((one) => isNew(one.key))
      .map((one) => ({ gesture: 'escalated' as const, text: one.notice.text, isRoutine: false }))
  ]
  return { seen: { keys, main }, cues, decisions }
}

/** `cue` from `tick`, unless the gesture still playing is stronger. */
export const playingCueOf = (
  playing: PlayingCue | undefined,
  cue: AdvisorCue,
  tick: number
): PlayingCue => {
  const isPlaying = playing !== undefined && tick - playing.at < cueTicksOf(playing.cue.gesture)
  return isPlaying && RANK[playing.cue.gesture] > RANK[cue.gesture] ? playing : { cue, at: tick }
}

/** A `classic.PreToolUse` verdict as the hooks beneath the game return it. */
export type GateVerdict = { allow?: true; ask?: string; deny?: string }

// Why the text: the gate's verdict names no judge, but its own wording does (orca-supervisor i18n_gate.ts).
const HOOK_ERROR = /^PreToolUse:\S+ hook error: /
const GATE_ADVICE = /^(Jev|Clef) advice \(not a refusal\)/
const GATE_REFUSED = /^REFUSED: /

/** What Jev's gate decided about a Bash command, whichever of Jev or Clef judged it; another hook's verdict is none. */
export const gateCueOf = (
  tool: string,
  command: unknown,
  verdict: GateVerdict
): AdvisorCue | undefined => {
  if (tool !== 'Bash' || typeof command !== 'string') {
    return undefined
  }
  const line = command.trim().split('\n')[0]?.trim() ?? ''
  if (verdict.allow === true) {
    return { gesture: 'approved', text: line, isRoutine: true }
  }
  const reason = verdict.deny?.replace(HOOK_ERROR, '') ?? ''
  const judge = GATE_ADVICE.exec(reason)?.[1]
  if (judge !== undefined) {
    return { gesture: 'stopped', text: `${judge.toLowerCase()} · ${line}`, isRoutine: false }
  }
  return GATE_REFUSED.test(reason)
    ? { gesture: 'stopped', text: line, isRoutine: false }
    : undefined
}

export const strongestCueOf = (cues: readonly AdvisorCue[]): AdvisorCue | undefined =>
  cues.reduce<AdvisorCue | undefined>(
    (best, one) => (best === undefined || RANK[one.gesture] > RANK[best.gesture] ? one : best),
    undefined
  )

/** The bubble's words: only width-1 characters, as a Raster refuses a frame over one wide one. */
export const advisorBubbleOf = (cue: AdvisorCue, isZen: boolean): string =>
  isZen && cue.isRoutine
    ? ''
    : [...cue.text.replace(/\s+/g, ' ')]
        .filter((one) => isRasterText(one))
        .join('')
        .replace(/ {2,}/g, ' ')
        .trim()
