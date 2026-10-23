import {
  GAME_HISTORY_OUTCOMES,
  type GameHistoryOutcome,
  type GameHistoryRecord
} from './orchestrator-game-history'

/** One task a character finished, as `orca game characters` lists it. */
export type GameCharacterTask = {
  ticket: string | null
  outcome: GameHistoryOutcome
  pr: string | null
  endedAt: string
  /** Null when the member's launch time was not known. */
  workedMs: number | null
}

/** A game character's saved progress in one project, kept across Orca restarts. */
export type GameCharacter = {
  /** The roster entry's first variant, lowercased, so `Arthur` and `Arturo` are one character. */
  key: string
  /** The name it was last shown under. */
  name: string
  tickets: number
  prsOpened: number
  prsMerged: number
  outcomes: Record<GameHistoryOutcome, number>
  workedMs: number
  xp: number
  lastAt: string
  /** Oldest first. */
  recent: GameCharacterTask[]
}

export type GameCharacterLevel = { level: number; into: number; need: number }

// Why outcome-only: XP rewards what landed, not activity (ORCA-686 builds on this).
export const GAME_CHARACTER_XP: Readonly<Record<GameHistoryOutcome, number>> = {
  merged: 100,
  qa: 50,
  stopped: 0,
  failed: 0,
  limited: 0
}

export const GAME_CHARACTER_RECENT_MAX = 20
// Why bounded: tasks already folded in, so a retried free never counts one twice.
const APPLIED_MAX = 50

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

function parseTask(raw: unknown): GameCharacterTask | null {
  if (!isRecord(raw) || typeof raw.endedAt !== 'string') {
    return null
  }
  const outcome = GAME_HISTORY_OUTCOMES.find((one) => one === raw.outcome)
  if (!outcome) {
    return null
  }
  return {
    ticket: textOrNull(raw.ticket),
    outcome,
    pr: textOrNull(raw.pr),
    endedAt: raw.endedAt,
    workedMs: typeof raw.workedMs === 'number' ? count(raw.workedMs) : null
  }
}

function parseCharacter(raw: unknown): (GameCharacter & { applied: string[] }) | null {
  if (!isRecord(raw) || typeof raw.key !== 'string' || typeof raw.name !== 'string') {
    return null
  }
  const outcomes = isRecord(raw.outcomes) ? raw.outcomes : {}
  return {
    key: raw.key,
    name: raw.name,
    tickets: count(raw.tickets),
    prsOpened: count(raw.prsOpened),
    prsMerged: count(raw.prsMerged),
    outcomes: Object.fromEntries(
      GAME_HISTORY_OUTCOMES.map((outcome) => [outcome, count(outcomes[outcome])])
    ) as Record<GameHistoryOutcome, number>,
    workedMs: count(raw.workedMs),
    xp: count(raw.xp),
    lastAt: typeof raw.lastAt === 'string' ? raw.lastAt : '',
    recent: Array.isArray(raw.recent) ? raw.recent.flatMap((one) => parseTask(one) ?? []) : [],
    applied: Array.isArray(raw.applied)
      ? raw.applied.filter((one): one is string => typeof one === 'string')
      : []
  }
}

/** Every character a store kept, most XP first; entries this build cannot read are skipped. */
export function listGameCharacters(stored: Record<string, unknown>): GameCharacter[] {
  return Object.values(stored)
    .flatMap((raw) => parseCharacter(raw) ?? [])
    .map(({ applied: _applied, ...character }) => character)
    .toSorted((a, b) => b.xp - a.xp || a.key.localeCompare(b.key))
}

function workedMsOf(record: GameHistoryRecord): number | null {
  const ms = record.launchedAt
    ? Date.parse(record.endedAt) - Date.parse(record.launchedAt)
    : Number.NaN
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

// Why the launch, not the end: a sweep and a stop of one task stamp different end times. With no
// launch time the ticket alone keys it; a retake of that ticket then counts once, never twice.
const taskKeyOf = (record: GameHistoryRecord): string =>
  record.launchedAt === null && record.ticket !== null
    ? `${record.ticket}|`
    : `${record.ticket ?? ''}|${record.launchedAt ?? record.endedAt}`

/**
 * The stored characters with a freed member's task added to its character; null when that task is
 * already counted. Entries it does not touch are kept as they were, a newer build's included.
 */
export function foldFreedMember(
  stored: Record<string, unknown>,
  character: { key: string; name: string },
  record: GameHistoryRecord
): Record<string, unknown> | null {
  const before = parseCharacter(stored[character.key])
  const taskKey = taskKeyOf(record)
  if (before?.applied.includes(taskKey)) {
    return null
  }
  const workedMs = workedMsOf(record)
  const task: GameCharacterTask = {
    ticket: record.ticket,
    outcome: record.outcome,
    pr: record.pr,
    endedAt: record.endedAt,
    workedMs
  }
  const outcomes = before?.outcomes ?? { merged: 0, qa: 0, stopped: 0, failed: 0, limited: 0 }
  const next: GameCharacter & { applied: string[] } = {
    key: character.key,
    name: character.name,
    tickets: (before?.tickets ?? 0) + (record.ticket === null ? 0 : 1),
    prsOpened: (before?.prsOpened ?? 0) + (record.pr === null ? 0 : 1),
    prsMerged: (before?.prsMerged ?? 0) + (record.pr?.endsWith(' merged') ? 1 : 0),
    outcomes: { ...outcomes, [record.outcome]: outcomes[record.outcome] + 1 },
    workedMs: (before?.workedMs ?? 0) + (workedMs ?? 0),
    xp: (before?.xp ?? 0) + GAME_CHARACTER_XP[record.outcome],
    lastAt: record.endedAt,
    recent: [...(before?.recent ?? []), task].slice(-GAME_CHARACTER_RECENT_MAX),
    applied: [...(before?.applied ?? []), taskKey].slice(-APPLIED_MAX)
  }
  return { ...stored, [character.key]: next }
}

// Why not `no-project`: unrelated folders share that key, so their characters would merge.
/** Which character a freed member's record counts for; null when none should. */
export function freedCharacterOf(args: {
  projectKey: string
  character?: string
  characterKey?: string
}): { key: string; name: string } | null {
  const name = args.character?.trim() ?? ''
  if (args.projectKey === 'no-project' || name.length === 0) {
    return null
  }
  return { key: (args.characterKey?.trim() || name).toLowerCase(), name }
}

/** Same curve as the band's fleet XP: 100 to reach level 2, then 100 × level per level. */
export function gameCharacterLevelOf(xp: number): GameCharacterLevel {
  let level = 1
  let into = Math.max(0, xp)
  let need = 100
  while (into >= need) {
    into -= need
    level += 1
    need = 100 * level
  }
  return { level, into, need }
}
