import type {
  GameMemberAdvisor,
  GameMemberAdvisorDetail,
  GameMemberAdvisorPick,
  GameMemberLaunch
} from '../types'
import { cellWidthOf, fitCells } from './cell-width'
import { gameStrings } from './game-strings'
import { modelSourceWordOf } from './member-model-source'

// What a member card says about the model and effort Jev has that member on.

const isShape = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const pickOf = (value: Record<string, unknown>): GameMemberAdvisorPick => ({
  model: textOrNull(value.model),
  effort: textOrNull(value.effort)
})

const DETAIL_KEYS = [
  'line',
  'skill',
  'tool',
  'hold',
  'confidence',
  'routedModel',
  'sessionModel'
] as const

// Why: a field of another type is dropped alone, so the rest of the report still shows.
const detailOf = (value: Record<string, unknown>): GameMemberAdvisorDetail => {
  const detail: GameMemberAdvisorDetail = {}
  for (const key of DETAIL_KEYS) {
    const one = value[key]
    if (typeof one === 'string' || one === null) {
      detail[key] = one
    }
  }
  return detail
}

export const memberAdvisorOf = (value: unknown): GameMemberAdvisor | undefined => {
  if (!isShape(value) || (value.model !== null && typeof value.model !== 'string')) {
    return undefined
  }
  const pinned = isShape(value.pinned) ? value.pinned : {}
  return {
    ...pickOf(value),
    ...detailOf(value),
    pinned: { model: pinned.model === true, effort: pinned.effort === true },
    ...(isShape(value.previous) ? { previous: pickOf(value.previous) } : {})
  }
}

export const memberLaunchOf = (value: unknown): GameMemberLaunch | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const launch = pickOf(value)
  const isText = (one: unknown) => one === undefined || one === null || typeof one === 'string'
  const source = value.source === 'session' || value.source === 'launch' ? value.source : undefined
  return isText(value.model) && isText(value.effort) && (launch.model ?? launch.effort) !== null
    ? { ...launch, ...(source ? { source } : {}) }
    : undefined
}

const pickText = (pick: GameMemberAdvisorPick): string =>
  [pick.model ?? '', pick.effort ?? ''].filter((one) => one !== '').join('·')

// Why whole when nothing fits: the card wraps it, so the model is never cut.
const fitted = (tries: readonly string[], room: number): string =>
  tries.find((one) => cellWidthOf(one) <= room) ?? tries.at(-1) ?? ''

// Why only what changed: "Opus 5.5 → Sonnet 5.5" reads at a glance where the full pair would not fit.
const switchOf = (before: GameMemberAdvisorPick, now: GameMemberAdvisorPick): string => {
  const isModelSame = before.model === now.model
  const isEffortSame = before.effort === now.effort
  if (isModelSame && isEffortSame) {
    return ''
  }
  const side = (pick: GameMemberAdvisorPick) =>
    isModelSame ? (pick.effort ?? '') : isEffortSame ? (pick.model ?? '') : pickText(pick)
  return `↳ ${side(before) || '?'} → ${side(now) || '?'}`
}

// Why one row each: a detail line is cut to the card, never wrapped into the model row.
const detailRowsOf = (advisor: GameMemberAdvisor): string[] => {
  const doing = [advisor.skill, advisor.tool].filter((one) => one)
  const rows = [
    advisor.line ? `› ${advisor.line}` : '',
    doing.length > 0 ? `⚙ ${doing.join(' · ')}` : '',
    advisor.hold ? `⏸ ${advisor.hold}` : '',
    advisor.confidence ? `confidence ${advisor.confidence}` : '',
    advisor.routedModel ? `↝ routed ${advisor.routedModel}` : '',
    advisor.sessionModel ? `session ${advisor.sessionModel}` : ''
  ]
  return rows.filter((row) => row !== '')
}

/** The card's Jev rows fit to `room` cells: Jev's name goes first, then the pin; the rest wraps. */
export const memberAdvisorLinesOf = (advisor: GameMemberAdvisor, room: number): string[] => {
  const now = pickText(advisor)
  if (now === '') {
    return []
  }
  const pins = gameStrings().text.advisorPinned(advisor.pinned)
  const pinned = pins === '' ? '' : ` · ${pins}`
  const head = fitted([`◆ Jev ${now}${pinned}`, `◆ ${now}${pinned}`, `◆ ${now}`], room)
  const moved = advisor.previous === undefined ? '' : switchOf(advisor.previous, advisor)
  const rows = moved === '' ? [head] : [head, moved]
  return [...rows, ...detailRowsOf(advisor).map((row) => fitCells(row, room))]
}

type MemberModels = { advisor?: GameMemberAdvisor; launch?: GameMemberLaunch }

// Why Jev first: it may have moved the member off the model Orca launched it on.
const pickNowOf = (agent: MemberModels): GameMemberAdvisorPick | undefined =>
  agent.advisor?.model ? agent.advisor : (agent.launch ?? agent.advisor)

/** What the member runs now as `model·effort`; null when neither Jev nor its launch names one. */
export const memberModelOf = (agent: MemberModels): string | null => {
  const pick = pickNowOf(agent)
  const text = pick === undefined ? '' : pickText(pick)
  return text === '' ? null : text
}

/** A card's model rows: its Jev's when it reports one, else `◇` and the model Orca launched it on. */
export const memberModelLinesOf = (agent: MemberModels, room: number): string[] => {
  if (agent.advisor !== undefined && pickText(agent.advisor) !== '') {
    return memberAdvisorLinesOf(agent.advisor, room)
  }
  const launch = agent.launch === undefined ? '' : pickText(agent.launch)
  const source = agent.launch?.source
  const from = source ? `${modelSourceWordOf(source)} ` : ''
  return launch === '' ? [] : [`◇ ${from}${launch}`]
}

/** "◆ 2 on Sonnet 5.5, 1 on Opus 5.5" for the members whose Jev or launch names a model; null for none. */
export const fleetAdvisorSummaryOf = (agents: readonly MemberModels[]): string | null => {
  const counts = new Map<string, number>()
  for (const agent of agents) {
    const model = pickNowOf(agent)?.model
    if (model !== undefined && model !== null && model !== '') {
      counts.set(model, (counts.get(model) ?? 0) + 1)
    }
  }
  if (counts.size === 0) {
    return null
  }
  const on = gameStrings().text.membersOn
  const groups = [...counts].sort((a, b) => b[1] - a[1]).map(([model, count]) => on(count, model))
  return `◆ ${groups.join(', ')}`
}
