import type { EngineInterface, TurnStepInput } from 'claude-code'

import { advisorPinsOf, type AdvisorPins } from './advisor-report'
import { askStewardJudge, stewardJudgeAllowed, type StewardJudgeBudget } from './steward-judge'
import { readStewardPlan, readStewardTicket } from './steward-plan-read'
import { routerRouteOf } from './steward-router'
import {
  STEWARD_MOMENT_WHY,
  stewardLogWith,
  stewardSessionsWith,
  type StewardDecision,
  type StewardPlanState,
  type StewardRecord
} from './steward-record'
import {
  isSamePick,
  stewardChoiceOf,
  stewardEffortOf,
  stewardMomentOf,
  withPins,
  withQuota,
  type StewardPhase,
  type StewardPick,
  type StewardPlanPhase,
  type StewardTrack
} from './steward-rules'

// The Orca steward (ORCA-1242): in a member pane, at key moments, it picks the main loop's model
// and effort from the lead's plan and the floors, and re-applies that pick on every main step,
// since a step's rewrite lasts one step. It stands down when Jev routed or the step was overridden.

const PLAN_EVERY_MS = 120_000
const STORE_KEY = 'steward'
const TOOL_LINES = 10
const ANNOUNCE_TOOLS: ReadonlySet<string> = new Set(['ExitPlanMode', 'TodoWrite'])

type Runtime = {
  role: 'member' | 'other' | null
  base: StewardPick | null
  pins: AdvisorPins
  pick: StewardPick | null
  track: StewardTrack
  ticket: string | null
  title: string
  plan: StewardPlanPhase[] | null
  planState: StewardPlanState
  planReadAt: number | null
  budget: StewardJudgeBudget
  quota: number
  tools: string[]
  standDown: 'router' | 'override' | null
  stepsSeen: number
  decisions: StewardDecision[]
}

// Module state: one member session; a hot reload starts it over from the next step.
const runtime: Runtime = {
  role: null,
  base: null,
  pins: { model: false, effort: false },
  pick: null,
  track: { phase: null, failing: null },
  ticket: null,
  title: '',
  plan: null,
  planState: 'none-yet',
  planReadAt: null,
  budget: { calls: 0, lastAt: null },
  quota: 0,
  tools: [],
  standDown: null,
  stepsSeen: 0,
  decisions: []
}

async function isMember($: EngineInterface): Promise<boolean> {
  if (runtime.role === null) {
    const role = await $.env.get('ORCA_GAME_ROLE').catch(() => undefined)
    runtime.role = role === 'member' ? 'member' : 'other'
  }
  return runtime.role === 'member'
}

const recordOf = (): StewardRecord => ({
  version: 1,
  phase: runtime.track.phase,
  pick: runtime.pick,
  planState: runtime.planState,
  standDown: runtime.standDown,
  stepsSeen: runtime.stepsSeen,
  decisions: runtime.decisions
})

async function saveRecord($: EngineInterface): Promise<void> {
  const [session, held] = await Promise.all([$.session.id(), $.store.get(STORE_KEY)]).catch(
    () => []
  )
  if (session !== undefined) {
    const sessions = stewardSessionsWith(held, session, recordOf())
    await $.store.set(STORE_KEY, sessions).catch(() => undefined)
  }
}

async function note($: EngineInterface, entry: Omit<StewardDecision, 'at'>): Promise<void> {
  const at = await $.clock.now()
  runtime.decisions = stewardLogWith(runtime.decisions, { at, ...entry })
  await saveRecord($)
}

type Judged = { confidence: number; why: string; tokens: { input: number; output: number } }

/** Applies a moment's choice: the plan's or the kind table's, a judgment's, quota, pins, floors. */
function decide(
  $: EngineInterface,
  phase: StewardPhase,
  moment: StewardDecision['moment'],
  judged?: Judged
): void {
  const base = runtime.base
  const current = runtime.pick ?? base
  if (base === null || current === null) {
    return
  }
  const choice = stewardChoiceOf({
    phase,
    plan: runtime.plan,
    current,
    ...(judged ? { confidence: judged.confidence } : {})
  })
  const to = withPins(withQuota(choice.pick, runtime.quota), base, runtime.pins)
  runtime.pick = to
  runtime.track = { ...runtime.track, phase }
  void note($, {
    moment,
    phase,
    from: current,
    to,
    applied: runtime.standDown === null && !isSamePick(current, to),
    source: judged ? 'haiku' : choice.source,
    why: judged?.why ?? STEWARD_MOMENT_WHY[moment],
    ...(choice.isFloored ? { isFloored: true as const } : {}),
    ...(judged ? { confidence: judged.confidence, tokens: judged.tokens } : {})
  })
}

/** Asks Haiku what the work is; any failure keeps the current pick and only the log says so. */
async function judge($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const current = runtime.pick ?? runtime.base
  if (current === null || !stewardJudgeAllowed(runtime.budget, now)) {
    return
  }
  runtime.budget = { calls: runtime.budget.calls + 1, lastAt: now }
  const task = `${runtime.ticket ?? ''} ${runtime.title}`.trim()
  const answer = await askStewardJudge($, { task, tools: runtime.tools })
  if (answer.verdict !== null) {
    decide($, answer.verdict.phase, 'judged', { ...answer.verdict, tokens: answer.tokens })
    return
  }
  await note($, {
    moment: 'judged',
    phase: runtime.track.phase,
    from: current,
    to: current,
    applied: false,
    source: 'haiku',
    why: 'the steward could not judge',
    failure: answer.failure
  })
}

/** Reads the lead's plan once the first state poll names the ticket, then every two minutes. */
async function refreshPlan($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (runtime.planReadAt !== null && now - runtime.planReadAt < PLAN_EVERY_MS) {
    return
  }
  const named = runtime.ticket === null ? await readStewardTicket($) : null
  if (named !== null) {
    runtime.ticket = named.ticket
    runtime.title = named.title
  }
  if (runtime.ticket === null) {
    return
  }
  runtime.planReadAt = now
  const read = await readStewardPlan($, runtime.ticket)
  if (read === null) {
    return
  }
  const isFirst = runtime.planState === 'none-yet'
  const isChanged = JSON.stringify(read.phases) !== JSON.stringify(runtime.plan)
  runtime.plan = read.phases
  runtime.planState = read.state
  const phase = runtime.track.phase ?? read.phases?.[0]?.phase
  if (read.state === 'none') {
    await (isFirst ? judge($) : saveRecord($))
  } else if (phase !== undefined && (isFirst || isChanged)) {
    decide($, phase, 'plan')
  }
}

function onToolCall($: EngineInterface, tool: string, e: object, isError: boolean): void {
  const command: unknown = Reflect.get(e, 'command')
  const path: unknown = Reflect.get(e, 'file_path')
  const call = {
    tool,
    ...(typeof command === 'string' ? { command } : {}),
    ...(typeof path === 'string' ? { path } : {}),
    isError
  }
  runtime.tools = [...runtime.tools, `${tool} ${call.path ?? call.command ?? ''}`.slice(0, 120)]
  runtime.tools = runtime.tools.slice(-TOOL_LINES)
  const moment = stewardMomentOf(runtime.track, call)
  runtime.track = moment.track
  if (moment.phase !== undefined && moment.reason !== undefined) {
    decide($, moment.phase, moment.reason)
  } else if (ANNOUNCE_TOOLS.has(tool) && runtime.planState === 'none') {
    void judge($).catch(() => undefined)
  }
}

async function onTurnComplete($: EngineInterface): Promise<void> {
  const usage = await $.session.usage().catch(() => null)
  const used = Math.max(0, ...(usage?.rateLimits ?? []).map((one) => one.percentUsed))
  const crossed = runtime.quota < 85 && used >= 85
  runtime.quota = used
  if (crossed && runtime.track.phase !== null) {
    decide($, runtime.track.phase, 'quota')
  }
  await refreshPlan($)
  await saveRecord($)
}

/** The step as the steward sends it: the member's sticky pick, unless it stands down. */
export async function stewardStepOf($: EngineInterface, e: TurnStepInput): Promise<TurnStepInput> {
  if (e.agentId !== undefined || !(await isMember($))) {
    return e
  }
  runtime.stepsSeen += 1
  if (runtime.base === null) {
    runtime.base = { model: e.model, effort: stewardEffortOf(e.effort) }
    runtime.pins = await advisorPinsOf($)
    void refreshPlan($).catch(() => undefined)
  }
  const base = runtime.base
  const served = { model: e.model, effort: stewardEffortOf(e.effort) }
  const routed = await routerRouteOf($)
  const standDown = routed ? 'router' : isSamePick(served, base) ? null : 'override'
  if (standDown !== runtime.standDown) {
    runtime.standDown = standDown
    const kept = runtime.pick ?? base
    void note($, {
      moment: 'stand-down',
      phase: runtime.track.phase,
      from: kept,
      to: routed ?? (standDown === null ? kept : served),
      applied: standDown === null,
      source: standDown ?? 'none',
      why: standDown === null ? 'the steward picks again' : STEWARD_MOMENT_WHY['stand-down']
    })
  }
  const pick = runtime.pick
  if (standDown !== null || pick === null) {
    return e
  }
  return { ...e, model: pick.model, ...(pick.effort ? { effort: pick.effort } : {}) }
}

/** A main-loop tool call that just ran: a key moment when it moves the member to another phase. */
export function noteStewardToolCall(
  $: EngineInterface,
  e: { tool: unknown; agentId?: string },
  answered: { isError?: true }
): void {
  if (e.agentId === undefined && runtime.base !== null && runtime.role === 'member') {
    onToolCall($, String(e.tool), e, answered.isError === true)
  }
}

export function noteStewardTurnComplete($: EngineInterface, agentId: string | undefined): void {
  if (agentId === undefined && runtime.base !== null && runtime.role === 'member') {
    void onTurnComplete($).catch(() => undefined)
  }
}
