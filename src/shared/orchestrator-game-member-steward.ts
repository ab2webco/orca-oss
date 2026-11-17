import { stripTerminalControl } from './terminal-control-stripping'

// What a member pane's Orca steward reports on each state poll (ORCA-1242): its pick, the plan it
// follows and its latest decisions. Separate from Jev's report so an older lead never draws it as Jev.

export const GAME_MEMBER_STEWARD_VERSION = 1
export const GAME_MEMBER_STEWARD_DECISIONS_MAX = 10
export const GAME_STEWARD_TICKET = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/

export type GameStewardPick = { model: string; effort: string | null }

export type GameStewardDecision = {
  at: number
  moment: string
  phase: string | null
  from: GameStewardPick
  to: GameStewardPick
  applied: boolean
  source: string
  why: string
  isFloored?: true
  confidence?: number
  failure?: string
  tokens?: { input: number; output: number }
}

export type GameMemberSteward = {
  session: string | null
  ticket: string | null
  /** The pick it re-applies on every main step; null before its first decision. */
  model: string | null
  effort: string | null
  phase: string | null
  plan: 'plan' | 'none' | 'none-yet'
  standDown: 'router' | 'override' | null
  pinned: { model: boolean; effort: boolean }
  stepsSeen: number
  decisions: GameStewardDecision[]
}

type Shape = Record<string, unknown>

const shapeOf = (value: unknown): Shape =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Shape) : {}

const wordsOf = (value: unknown, max = 64): string | null => {
  const words =
    typeof value === 'string' ? stripTerminalControl(value).replace(/\s+/g, ' ').trim() : ''
  return words === '' ? null : words.slice(0, max)
}

const countOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null =>
  list.includes(value as T) ? (value as T) : null

const pickOf = (value: unknown): GameStewardPick | null => {
  const { model, effort } = shapeOf(value)
  const name = wordsOf(model)
  return name === null ? null : { model: name, effort: wordsOf(effort) }
}

// Why one bad decision is dropped alone: the rest of the history still reads.
export function parseGameStewardDecision(value: unknown): GameStewardDecision | null {
  const raw = shapeOf(value)
  const [at, moment, source] = [countOf(raw.at), wordsOf(raw.moment), wordsOf(raw.source)]
  const [from, to, why] = [pickOf(raw.from), pickOf(raw.to), wordsOf(raw.why, 240)]
  if (at === null || !moment || !from || !to || !source || why === null) {
    return null
  }
  const confidence = countOf(raw.confidence)
  const failure = wordsOf(raw.failure)
  const tokens = shapeOf(raw.tokens)
  const [input, output] = [countOf(tokens.input), countOf(tokens.output)]
  const phase = wordsOf(raw.phase)
  return {
    at,
    moment,
    phase,
    from,
    to,
    applied: raw.applied === true,
    source,
    why,
    ...(raw.isFloored === true ? { isFloored: true as const } : {}),
    ...(confidence !== null && confidence <= 1 ? { confidence } : {}),
    ...(failure ? { failure } : {}),
    ...(input !== null && output !== null ? { tokens: { input, output } } : {})
  }
}

/** Null when the steward stopped reporting; undefined for a shape this build cannot read, which is ignored. */
export function parseGameMemberSteward(value: unknown): GameMemberSteward | null | undefined {
  if (value === null) {
    return null
  }
  const raw = shapeOf(value)
  if (raw.version !== GAME_MEMBER_STEWARD_VERSION) {
    return undefined
  }
  const pinned = shapeOf(raw.pinned)
  const decisions = Array.isArray(raw.decisions) ? raw.decisions : []
  return {
    session: wordsOf(raw.session),
    ticket: wordsOf(raw.ticket),
    model: pickOf(raw)?.model ?? null,
    effort: pickOf(raw)?.effort ?? null,
    phase: wordsOf(raw.phase),
    plan: oneOf(['plan', 'none', 'none-yet'], raw.plan) ?? 'none-yet',
    standDown: oneOf(['router', 'override'], raw.standDown),
    pinned: { model: pinned.model === true, effort: pinned.effort === true },
    stepsSeen: countOf(raw.stepsSeen) ?? 0,
    decisions: decisions
      .slice(-GAME_MEMBER_STEWARD_DECISIONS_MAX)
      .flatMap((one) => parseGameStewardDecision(one) ?? [])
  }
}

/** A steward a host relays back; it carries no version, as the host keeps the parsed report. */
export const parseRelayedGameMemberSteward = (value: unknown): GameMemberSteward | null =>
  typeof value === 'object' && value !== null
    ? (parseGameMemberSteward({ ...value, version: GAME_MEMBER_STEWARD_VERSION }) ?? null)
    : null
