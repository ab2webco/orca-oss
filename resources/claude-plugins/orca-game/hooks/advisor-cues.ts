import type { Advisor, AdvisorAgent } from './allies'
import { isRasterText } from './game-strings'
import type { AdvisorGesture } from './scenes/index'

// Which of Jev's changes the advisor acts out: a new decision, CI state or escalation, never a redraw.

export type AdvisorCue = { gesture: AdvisorGesture; text: string; isRoutine: boolean }

/** One decision for the Panel: a subagent's, or the main conversation's when `title` is null. */
export type AdvisorDecision = {
  key: string
  title: string | null
  model: string | null
  effort: string | number | null
  verdict: string
  gesture: AdvisorGesture | null
}

/** What was already acted out; a value whose keys are all here plays nothing. */
export type AdvisorSeen = { keys: ReadonlySet<string>; main: string }

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
  ciFailed: 6,
  ciPassed: 5,
  lowered: 4,
  raised: 4,
  unsure: 3,
  ciRunning: 2,
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
  const keys = new Set([...agents, ...runs, ...blocks].map((one) => one.key))
  if (seen === null) {
    return { seen: { keys, main }, cues: [], decisions: advisor.subagents.map(decisionOf) }
  }
  const isNew = (key: string) => !seen.keys.has(key)
  const freshAgents = agents.filter((one) => isNew(one.key)).map((one) => one.agent)
  const isMainNew = main !== seen.main && main !== ''
  const decisions: AdvisorDecision[] = [
    ...(isMainNew
      ? [
          {
            key: `main|${main}`,
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
