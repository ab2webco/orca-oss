import { gameMemberLaunchOf } from './orchestrator-game-member-launch'
import {
  GAME_KIND_LAUNCH,
  GAME_TICKET_KINDS,
  type GameTicketKind
} from './orchestrator-game-ticket-kind'

export const GAME_PLAN_PHASES = [
  'map',
  'design',
  'implement',
  'test-fix',
  'captures',
  'pr-ci'
] as const

/** A stretch of a member's ticket the lead plans a model and effort for (ORCA-1242). */
export type GamePlanPhaseName = (typeof GAME_PLAN_PHASES)[number]

export const GAME_PLAN_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export type GamePlanEffort = (typeof GAME_PLAN_EFFORTS)[number]

export type GamePlanPhase = {
  phase: GamePlanPhaseName
  model: string
  effort: GamePlanEffort
  why: string
}

/**
 * The lead's effort plan for one ticket: the steward's prior. `kind` when Orca seeded it from the
 * ticket kind at launch, `lead` once the lead wrote it.
 */
export type GameEffortPlan = {
  source: 'kind' | 'lead'
  kind: GameTicketKind | null
  phases: GamePlanPhase[]
}

export type GamePlanParse<T> = ({ ok: true } & T) | { ok: false; error: string }

// Why effort only (ORCA-1350): a model switch rewrites a warm prompt cache; the kind picks the model.
const PHASE_DEFAULTS: Readonly<Record<GamePlanPhaseName, { effort: GamePlanEffort; why: string }>> =
  {
    map: { effort: 'medium', why: 'read and map the code before changing it' },
    design: { effort: 'high', why: 'review and design judgement' },
    implement: { effort: 'high', why: 'editing product code' },
    'test-fix': { effort: 'high', why: 'fixing failing tests edits code' },
    captures: { effort: 'medium', why: 'taking and reading captures' },
    'pr-ci': { effort: 'low', why: 'watching the PR and CI' }
  }

const KIND_PHASES: Readonly<Record<GameTicketKind, readonly GamePlanPhaseName[]>> = {
  audit: ['map'],
  review: ['map', 'design'],
  captures: ['map', 'captures'],
  implement: GAME_PLAN_PHASES
}

const CLAUDE_MODEL = /^claude-(?:opus|sonnet|haiku|fable)(?:-[a-z0-9]+)+$/

/** `opus-5-5` and `claude-opus-5-5` both name the same model. */
function claudeModelOf(value: string): string | null {
  const model = value.toLowerCase()
  const named = model.startsWith('claude-') ? model : `claude-${model}`
  return CLAUDE_MODEL.test(named) ? named : null
}

/** One `--phase` value: `name:model:effort:why`, where the why may hold colons. */
export function parseGamePlanPhase(text: string): GamePlanParse<{ phase: GamePlanPhase }> {
  const [rawName = '', rawModel = '', rawEffort = '', ...rest] = text.split(':')
  const name = rawName.trim().toLowerCase()
  const why = rest.join(':').trim()
  const phase = GAME_PLAN_PHASES.find((one) => one === name)
  if (!phase) {
    return {
      ok: false,
      error: `Unknown phase "${rawName.trim()}"; use one of ${GAME_PLAN_PHASES.join(', ')}.`
    }
  }
  const model = claudeModelOf(rawModel.trim())
  if (!model) {
    return {
      ok: false,
      error: `Phase ${phase}: "${rawModel.trim()}" is not a Claude model (e.g. opus-5-5).`
    }
  }
  const effort = GAME_PLAN_EFFORTS.find((one) => one === rawEffort.trim().toLowerCase())
  if (!effort) {
    return {
      ok: false,
      error: `Phase ${phase}: effort must be one of ${GAME_PLAN_EFFORTS.join(', ')}.`
    }
  }
  if (!why) {
    return { ok: false, error: `Phase ${phase}: say why after the effort (name:model:effort:why).` }
  }
  if (why.length > PLAN_WHY_MAX) {
    return { ok: false, error: `Phase ${phase}: keep the why under ${PLAN_WHY_MAX} characters.` }
  }
  return { ok: true, phase: { phase, model, effort, why } }
}

/** The lead's plan from its `--phase` values, in the order written. */
export function parseGameEffortPlan(values: readonly string[]): GamePlanParse<{
  plan: GameEffortPlan
}> {
  if (values.length === 0) {
    return { ok: false, error: 'Give at least one --phase name:model:effort:why.' }
  }
  const phases: GamePlanPhase[] = []
  for (const value of values) {
    const parsed = parseGamePlanPhase(value)
    if (!parsed.ok) {
      return parsed
    }
    if (phases.some(({ phase }) => phase === parsed.phase.phase)) {
      return { ok: false, error: `Phase ${parsed.phase.phase} is planned twice.` }
    }
    phases.push(parsed.phase)
  }
  return { ok: true, plan: { source: 'lead', kind: null, phases } }
}

const PLAN_WHY_MAX = 200

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A saved plan, or null when it is not one this Orca can read whole. */
export function gameEffortPlanOf(raw: unknown): GameEffortPlan | null {
  if (!isRecord(raw) || (raw.source !== 'kind' && raw.source !== 'lead')) {
    return null
  }
  const kind = raw.kind === null ? null : savedTicketKindOf(raw.kind)
  if (kind === undefined || !Array.isArray(raw.phases) || raw.phases.length === 0) {
    return null
  }
  const phases = raw.phases.map((one) =>
    isRecord(one) &&
    typeof one.phase === 'string' &&
    typeof one.model === 'string' &&
    typeof one.effort === 'string' &&
    typeof one.why === 'string'
      ? parseGamePlanPhase(`${one.phase}:${one.model}:${one.effort}:${one.why}`)
      : null
  )
  const read = phases.flatMap((one) => (one?.ok ? [one.phase] : []))
  return read.length === raw.phases.length ? { source: raw.source, kind, phases: read } : null
}

const savedTicketKindOf = (value: unknown): GameTicketKind | undefined =>
  typeof value === 'string' ? GAME_TICKET_KINDS.find((one) => one === value) : undefined

export function sameGameEffortPlan(
  one: GameEffortPlan | undefined,
  other: GameEffortPlan | undefined
): boolean {
  return JSON.stringify(one ?? null) === JSON.stringify(other ?? null)
}

/** The plan Orca seeds at launch from the ticket kind until the lead writes its own. */
export function gameKindEffortPlanOf(kind: GameTicketKind): GameEffortPlan {
  return {
    source: 'kind',
    kind,
    phases: KIND_PHASES[kind].map((phase) => ({
      phase,
      model: GAME_KIND_LAUNCH[kind].model,
      ...PHASE_DEFAULTS[phase]
    }))
  }
}

/** The plan as a person reads it in a terminal. */
export function gameEffortPlanText(plan: GameEffortPlan): string {
  const head =
    plan.source === 'kind'
      ? `plan: ${plan.kind ?? 'implement'} ticket default`
      : 'plan: by the lead'
  const rows = plan.phases.map(({ phase, model, effort, why }) => {
    const label = gameMemberLaunchOf({ model, effort })
    return [phase, `${label?.model ?? model} · ${effort}`, why] as const
  })
  const nameWidth = Math.max(...rows.map(([name]) => name.length))
  const modelWidth = Math.max(...rows.map(([, model]) => model.length))
  const models = new Set(plan.phases.map(({ model }) => model)).size
  const note =
    models > 1
      ? [
          `  note: ${models} models in one session; each switch rewrites its prompt cache. Keep one model and move effort, unless a phase outlasts the switch cost.`
        ]
      : []
  return [
    head,
    ...rows.map(
      ([name, model, why]) => `  ${name.padEnd(nameWidth)}  ${model.padEnd(modelWidth)}  ${why}`
    ),
    ...note
  ].join('\n')
}
