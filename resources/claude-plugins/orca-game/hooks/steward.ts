import type { EngineInterface } from 'claude-code'

import { withCache } from './steward-cache'
import {
  STEWARD_PHASE_TURNS,
  STEWARD_RETURNING_PHASES,
  cacheNowOf,
  outputPerTurnOf
} from './steward-cache-track'
import { askStewardJudge, stewardJudgeAllowed } from './steward-judge'
import { readStewardPlan, readStewardTicket } from './steward-plan-read'
import { STEWARD_MOMENT_WHY, type StewardDecision } from './steward-record'
import {
  isSamePick,
  stewardChoiceOf,
  stewardMomentOf,
  stewardStartPhaseOf,
  STEWARD_HIGH_RISK_PATHS,
  withPins,
  withQuota,
  type StewardPhase
} from './steward-rules'
import { cacheNoteOf, note, runtime, saveRecord } from './steward-runtime'

// The Orca steward (ORCA-1242): in a member pane, at key moments, it picks the main loop's model
// and effort from the lead's plan and the floors, and re-applies that pick on every main step,
// since a step's rewrite lasts one step. It stands down when Jev routed or the step was overridden.

const PLAN_EVERY_MS = 120_000
const TOOL_LINES = 10
const ANNOUNCE_TOOLS: ReadonlySet<string> = new Set(['ExitPlanMode', 'TodoWrite'])

type Judged = { confidence: number; why: string; tokens: { input: number; output: number } }

/** Leaving a phase logs the requests it took, so STEWARD_PHASE_TURNS can be tuned from data. */
function phaseTurnsOf(phase: StewardPhase): StewardDecision['phaseTurns'] {
  const run = runtime.phaseRun
  if (run.phase === phase) {
    return undefined
  }
  runtime.phaseRun = { phase, from: runtime.stepsSeen }
  return run.phase === null ? undefined : { phase: run.phase, turns: runtime.stepsSeen - run.from }
}

/** Applies a moment's choice: the plan's or the kind table's, a judgment's, quota, pins, floors, the cache. */
async function decide(
  $: EngineInterface,
  phase: StewardPhase,
  moment: StewardDecision['moment'],
  judged?: Judged
): Promise<void> {
  const base = runtime.base
  const current = runtime.pick ?? base
  if (base === null || current === null) {
    return
  }
  const choice = stewardChoiceOf({
    phase,
    plan: runtime.plan,
    current,
    hasEdited: runtime.track.hasEdited,
    isHighRisk: runtime.track.hasRiskyEdit === true,
    ...(judged ? { confidence: judged.confidence } : {})
  })
  const next = withPins(withQuota(choice.pick, runtime.quota), base, runtime.pins)
  const state = cacheNowOf(runtime.cache, await $.clock.now(), runtime.env)
  const phaseTurns = phaseTurnsOf(phase)
  const spent = runtime.stepsSeen - runtime.phaseRun.from
  const gate = withCache({
    current,
    next,
    cache: state,
    quota: runtime.quota,
    remainingTurns: Math.max(0, STEWARD_PHASE_TURNS[phase] - spent),
    outputTokensPerTurn: outputPerTurnOf(runtime.cache),
    login: runtime.env.login,
    returns: STEWARD_RETURNING_PHASES.has(phase)
  })
  const to = gate.pick
  runtime.pick = to
  runtime.cache = { ...runtime.cache, held: gate.held }
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
    ...(judged ? { confidence: judged.confidence, tokens: judged.tokens } : {}),
    cache: cacheNoteOf(state, gate),
    ...(phaseTurns ? { phaseTurns } : {})
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
    await decide($, answer.verdict.phase, 'judged', { ...answer.verdict, tokens: answer.tokens })
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
export async function refreshPlan($: EngineInterface): Promise<void> {
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
  runtime.riskyPaths = [...STEWARD_HIGH_RISK_PATHS, ...read.highRiskPaths]
  const phase = runtime.track.phase ?? stewardStartPhaseOf(read.phases ?? [])
  if (read.state === 'none') {
    await (isFirst ? judge($) : saveRecord($))
  } else if (phase !== null && (isFirst || isChanged)) {
    await decide($, phase, 'plan')
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
  const moment = stewardMomentOf(runtime.track, call, runtime.riskyPaths)
  runtime.track = moment.track
  const isPlanned = runtime.planState === 'plan'
  const isEditing = runtime.track.phase === 'implement' || runtime.track.phase === 'test-fix'
  if (moment.phase !== undefined && moment.reason !== undefined) {
    void decide($, moment.phase, moment.reason).catch(() => undefined)
  } else if (ANNOUNCE_TOOLS.has(tool) && runtime.planState === 'none') {
    void judge($).catch(() => undefined)
  } else if (tool === 'ExitPlanMode' && isPlanned && !isEditing) {
    // Why ExitPlanMode alone: a plan approved means editing is next; a todo list is only bookkeeping.
    void decide($, 'implement', 'announce').catch(() => undefined)
  }
}

async function onTurnComplete($: EngineInterface): Promise<void> {
  const usage = await $.session.usage().catch(() => null)
  const used = Math.max(0, ...(usage?.rateLimits ?? []).map((one) => one.percentUsed))
  const crossed = runtime.quota < 85 && used >= 85
  runtime.quota = used
  if (crossed && runtime.track.phase !== null) {
    await decide($, runtime.track.phase, 'quota')
  }
  await refreshPlan($)
  await saveRecord($)
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
