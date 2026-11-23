import type { EngineInterface, On, TurnStepInput } from 'claude-code'

import { advisorPinsOf } from './advisor-report'
import { cacheEnvOf, type CacheEnv, type CacheGate } from './steward-cache'
import { cacheNowOf, trackStepResult, trackStepStart } from './steward-cache-track'
import { STEWARD_MOMENT_WHY } from './steward-record'
import { routerRouteOf } from './steward-router'
import { isSamePick, stewardEffortOf } from './steward-rules'
import { refreshPlan } from './steward'
import { cacheNoteOf, isMember, note, runtime, type StandDownWhy } from './steward-runtime'

// Each main step the steward sends (ORCA-1242): its sticky pick, a held switch once the cache is
// cold (ORCA-1350), or the step as it came while another choice is in force.

const STAND_DOWN_WHY: Readonly<Record<StandDownWhy, string>> = {
  router: STEWARD_MOMENT_WHY['stand-down'],
  override: STEWARD_MOMENT_WHY['stand-down'],
  opusplan: 'opusplan switches the model with plan mode',
  fallback: 'an automatic fallback answered this turn'
}

// Why one call per name: the engine lists the variables a module reads from these literals.
async function envOf($: EngineInterface): Promise<CacheEnv> {
  const read = (value: Promise<string | undefined | null>) =>
    value.then((one) => one ?? undefined).catch(() => undefined)
  const [key, bedrock, vertex, betasOff, ttl, force5m, enable1h] = await Promise.all([
    read($.env.get('ANTHROPIC_API_KEY')),
    read($.env.get('CLAUDE_CODE_USE_BEDROCK')),
    read($.env.get('CLAUDE_CODE_USE_VERTEX')),
    read($.env.get('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS')),
    read($.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL')),
    read($.env.get('FORCE_PROMPT_CACHING_5M')),
    read($.env.get('ENABLE_PROMPT_CACHING_1H'))
  ])
  return cacheEnvOf({
    ANTHROPIC_API_KEY: key,
    CLAUDE_CODE_USE_BEDROCK: bedrock,
    CLAUDE_CODE_USE_VERTEX: vertex,
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: betasOff,
    CLAUDE_CODE_PROMPT_CACHE_TTL: ttl,
    FORCE_PROMPT_CACHING_5M: force5m,
    ENABLE_PROMPT_CACHING_1H: enable1h
  })
}

const OPUSPLAN_FLAG = /(?:^|\s)--model(?:=|\s+)opusplan(?:\s|$)/i

/** `--model opusplan` is no settings layer, so only the process's own command line shows it. */
async function isOpusplanFlag($: EngineInterface): Promise<boolean> {
  // Why no Windows path: `ps` fails there and the per-step check below still applies.
  const ran = await $.process.run(['sh', '-c', 'ps -o args= -p $PPID'], {}).catch(() => undefined)
  return ran?.exitCode === 0 && OPUSPLAN_FLAG.test(ran.stdout.split('\n')[0] ?? '')
}

/** Reads, once per turn, whether the model setting is opusplan and what the session resolves to. */
async function readTurnModel($: EngineInterface): Promise<void> {
  const setting: unknown = await $.settings.read({ key: 'model' }).catch(() => undefined)
  runtime.isOpusplan =
    runtime.isOpusplanFlag || (typeof setting === 'string' && /opusplan/i.test(setting))
  runtime.sessionModel = await $.session.model().catch(() => '')
}

/**
 * The setting or flag stands down every step; an Opus step in a Sonnet session only itself. Why the
 * pair: 2.1.330 resolves opusplan to Sonnet even while plan mode sends Opus (live check), and a
 * skill's `model: opus` or a fallback looks the same, so it must not latch.
 */
const isOpusplanStep = (stepModel: string): boolean =>
  /opus/i.test(stepModel) && /sonnet/i.test(runtime.sessionModel)

/** The engine compacted the main conversation: its history is rewritten, the cache cold. */
export const registerStewardCompact = (on: On): void => {
  on('session.compact', async (_$, e, next) => {
    const result = await next(e)
    // Why not precompute: that summary is made ahead of time and has not replaced the history yet.
    const isApplied = result.skip === undefined && e.trigger !== 'precompute'
    if (
      isApplied &&
      e.agentId === undefined &&
      runtime.base !== null &&
      runtime.role === 'member'
    ) {
      runtime.cache = { ...runtime.cache, isCompacted: true }
    }
    return result
  })
}

/** A switch the warm cache held lands on the first step after it went cold or compacted. */
async function landHeld($: EngineInterface, now: number): Promise<void> {
  const [held, current] = [runtime.cache.held, runtime.pick]
  if (held === null || current === null || runtime.standDown !== null) {
    return
  }
  const isCompacted = runtime.cache.isCompacted
  const state = cacheNowOf(runtime.cache, now, runtime.env)
  if (state.warm) {
    return
  }
  const moment = isCompacted ? 'compacted' : 'cold'
  runtime.pick = held
  runtime.cache = { ...runtime.cache, held: null }
  const gate: CacheGate = { pick: held, held: null, why: 'cold', cost: null }
  await note($, {
    moment,
    phase: runtime.track.phase,
    from: current,
    to: held,
    applied: true,
    source: 'cache',
    why: STEWARD_MOMENT_WHY[moment],
    cache: cacheNoteOf(state, gate)
  })
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
    runtime.env = await envOf($)
    runtime.isOpusplanFlag = await isOpusplanFlag($)
    void refreshPlan($).catch(() => undefined)
  }
  if (e.index === 0 || runtime.stepsSeen === 1) {
    await readTurnModel($)
  }
  const now = await $.clock.now()
  await landHeld($, now)
  const base = runtime.base
  const served = { model: e.model, effort: stewardEffortOf(e.effort) }
  const routed = await routerRouteOf($)
  const why: StandDownWhy | null = routed
    ? 'router'
    : runtime.isOpusplan
      ? 'opusplan'
      : runtime.cache.fallbackTurn === e.turnId
        ? 'fallback'
        : isOpusplanStep(e.model)
          ? 'opusplan'
          : isSamePick(served, base)
            ? null
            : 'override'
  const standDown = why === null ? null : why === 'router' ? 'router' : 'override'
  if (why !== runtime.standDownWhy) {
    runtime.standDown = standDown
    runtime.standDownWhy = why
    const kept = runtime.pick ?? base
    void note($, {
      moment: 'stand-down',
      phase: runtime.track.phase,
      from: kept,
      to: routed ?? (standDown === null ? kept : served),
      applied: standDown === null,
      source: why ?? 'none',
      why: why === null ? 'the steward picks again' : STAND_DOWN_WHY[why]
    })
  }
  const pick = runtime.pick
  const sent =
    standDown !== null || pick === null
      ? e
      : { ...e, model: pick.model, ...(pick.effort ? { effort: pick.effort } : {}) }
  runtime.cache = trackStepStart(runtime.cache, {
    model: sent.model,
    turnId: e.turnId,
    now
  })
  return sent
}

/** A main step's answer: its usage says how warm the cache is and which model really served. */
export function noteStewardStepResult(agentId: string | undefined, result: object): void {
  if (agentId === undefined && runtime.base !== null && runtime.role === 'member') {
    runtime.cache = trackStepResult(runtime.cache, Reflect.get(result, 'usage'), runtime.env)
  }
}
