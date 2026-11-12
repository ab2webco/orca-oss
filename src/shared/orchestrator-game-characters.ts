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
  account?: string
  /** The paired host it ran on; absent on this Orca. */
  host?: string
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
  /** Where it last ran; absent until a build that records them frees it. */
  account?: string
  host?: string
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
// Why bounded: PRs whose merge a character was paid for, so a merge seen again never pays twice.
const SETTLED_MAX = 100

/** `#41 merged` → 41. */
export const prNumberOf = (pr: string | null): number | null => {
  const found = pr ? /^#(\d+)\b/.exec(pr) : null
  return found ? Number(found[1]) : null
}

const prKeyOf = (ticket: string | null, number: number | null): string | null =>
  ticket && number !== null ? `${ticket.toUpperCase()}#${number}` : null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const seatOf = (raw: Record<string, unknown>): { account?: string; host?: string } => ({
  ...(typeof raw.account === 'string' && raw.account ? { account: raw.account } : {}),
  ...(typeof raw.host === 'string' && raw.host ? { host: raw.host } : {})
})

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
    workedMs: typeof raw.workedMs === 'number' ? count(raw.workedMs) : null,
    ...seatOf(raw)
  }
}

const textsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []

type StoredCharacter = GameCharacter & { applied: string[]; settled: string[] }

function parseCharacter(raw: unknown): StoredCharacter | null {
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
    ...seatOf(raw),
    recent: Array.isArray(raw.recent) ? raw.recent.flatMap((one) => parseTask(one) ?? []) : [],
    applied: textsOf(raw.applied),
    settled: textsOf(raw.settled)
  }
}

/** Every character a store kept, most XP first; entries this build cannot read are skipped. */
export function listGameCharacters(stored: Record<string, unknown>): GameCharacter[] {
  return Object.values(stored)
    .flatMap((raw) => parseCharacter(raw) ?? [])
    .map(({ applied: _applied, settled: _settled, ...character }) => character)
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
  const seat = seatOf(record)
  const task: GameCharacterTask = {
    ticket: record.ticket,
    outcome: record.outcome,
    pr: record.pr,
    endedAt: record.endedAt,
    workedMs,
    ...seat
  }
  const outcomes = before?.outcomes ?? { merged: 0, qa: 0, stopped: 0, failed: 0, limited: 0 }
  const prKey = prKeyOf(record.ticket, prNumberOf(record.pr))
  // Why: a merge the host already paid for (creditGameMerge) is not paid again by its free.
  const paid = prKey !== null && (before?.settled.includes(prKey) ?? false)
  const settled = before?.settled ?? []
  const next: StoredCharacter = {
    key: character.key,
    name: character.name,
    tickets: (before?.tickets ?? 0) + (record.ticket === null ? 0 : 1),
    prsOpened: (before?.prsOpened ?? 0) + (record.pr === null ? 0 : 1),
    prsMerged: (before?.prsMerged ?? 0) + (record.pr?.endsWith(' merged') ? 1 : 0),
    outcomes: { ...outcomes, [record.outcome]: outcomes[record.outcome] + 1 },
    workedMs: (before?.workedMs ?? 0) + (workedMs ?? 0),
    xp: (before?.xp ?? 0) + (paid ? 0 : GAME_CHARACTER_XP[record.outcome]),
    lastAt: record.endedAt,
    ...seat,
    recent: [...(before?.recent ?? []), task].slice(-GAME_CHARACTER_RECENT_MAX),
    applied: [...(before?.applied ?? []), taskKey].slice(-APPLIED_MAX),
    settled:
      record.outcome === 'merged' && prKey && !paid
        ? [...settled, prKey].slice(-SETTLED_MAX)
        : settled
  }
  return { ...stored, [character.key]: next }
}

/**
 * The stored characters with a merged PR paid to `character`, topping up what a QA free of that
 * PR already paid; null when that PR was already paid. Creates a character no free has written.
 */
export function creditGameMerge(
  stored: Record<string, unknown>,
  character: { key: string; name: string },
  merge: { ticket: string; number: number; at: string }
): Record<string, unknown> | null {
  const before = parseCharacter(stored[character.key])
  const prKey = prKeyOf(merge.ticket, merge.number)
  if (!prKey || before?.settled.includes(prKey)) {
    return null
  }
  // Why the recent tasks: an older build's merged free of this PR left no settled key.
  const earned = (before?.recent ?? [])
    .filter((task) => prKeyOf(task.ticket, prNumberOf(task.pr)) === prKey)
    .reduce((sum, task) => sum + GAME_CHARACTER_XP[task.outcome], 0)
  const base: StoredCharacter = before ?? {
    key: character.key,
    name: character.name,
    tickets: 0,
    prsOpened: 0,
    prsMerged: 0,
    outcomes: { merged: 0, qa: 0, stopped: 0, failed: 0, limited: 0 },
    workedMs: 0,
    xp: 0,
    lastAt: '',
    recent: [],
    applied: [],
    settled: []
  }
  const next: StoredCharacter = {
    ...base,
    name: character.name,
    xp: base.xp + Math.max(0, GAME_CHARACTER_XP.merged - earned),
    lastAt: base.lastAt > merge.at ? base.lastAt : merge.at,
    settled: [...base.settled, prKey].slice(-SETTLED_MAX)
  }
  return { ...stored, [character.key]: next }
}

const closedKeyOf = (ticket: string, number: number): string => `closed:${prKeyOf(ticket, number)}`

/** Whether a PR no longer needs a look: paid to the character, or closed unmerged. */
export function isReviewSettled(
  stored: Record<string, unknown>,
  characterKey: string,
  review: { ticket: string; number: number }
): boolean {
  const settled = parseCharacter(stored[characterKey])?.settled ?? []
  return (
    settled.includes(prKeyOf(review.ticket, review.number) ?? '') ||
    settled.includes(closedKeyOf(review.ticket, review.number))
  )
}

/** The stored characters with a PR that closed unmerged marked, so it is not looked at again. */
export function settleClosedReview(
  stored: Record<string, unknown>,
  character: { key: string; name: string },
  review: { ticket: string; number: number }
): Record<string, unknown> {
  const before = parseCharacter(stored[character.key])
  if (!before || isReviewSettled(stored, character.key, review)) {
    return stored
  }
  const settled = [...before.settled, closedKeyOf(review.ticket, review.number)]
  return { ...stored, [character.key]: { ...before, settled: settled.slice(-SETTLED_MAX) } }
}

/**
 * Another store's characters added to these: a character only one side has is kept as it was, and
 * one both have is summed unless a task of the other is already applied here (adopted before).
 */
export function mergeGameCharacters(
  stored: Record<string, unknown>,
  adopted: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...adopted, ...stored }
  for (const key of Object.keys(adopted)) {
    const mine = parseCharacter(stored[key])
    const theirs = parseCharacter(adopted[key])
    if (!mine || !theirs || theirs.applied.some((task) => mine.applied.includes(task))) {
      continue
    }
    const sum = (field: 'tickets' | 'prsOpened' | 'prsMerged' | 'workedMs' | 'xp'): number =>
      mine[field] + theirs[field]
    merged[key] = {
      ...mine,
      tickets: sum('tickets'),
      prsOpened: sum('prsOpened'),
      prsMerged: sum('prsMerged'),
      outcomes: Object.fromEntries(
        GAME_HISTORY_OUTCOMES.map((one) => [one, mine.outcomes[one] + theirs.outcomes[one]])
      ),
      workedMs: sum('workedMs'),
      xp: sum('xp'),
      lastAt: mine.lastAt > theirs.lastAt ? mine.lastAt : theirs.lastAt,
      recent: [...theirs.recent, ...mine.recent]
        .toSorted((a, b) => a.endedAt.localeCompare(b.endedAt))
        .slice(-GAME_CHARACTER_RECENT_MAX),
      applied: [...theirs.applied, ...mine.applied].slice(-APPLIED_MAX),
      settled: [...new Set([...theirs.settled, ...mine.settled])].slice(-SETTLED_MAX)
    }
  }
  return merged
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
