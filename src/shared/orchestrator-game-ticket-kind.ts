export const GAME_TICKET_KINDS = ['audit', 'implement', 'review', 'captures'] as const

/** What a member's ticket asks of it, which picks its launch model when nobody else did (ORCA-851). */
export type GameTicketKind = (typeof GAME_TICKET_KINDS)[number]

export const GAME_LAUNCH_KIND_SOURCES = ['flag', 'ticket', 'default'] as const

/**
 * Who picked a member's launch model when no flag or orca.yaml did: the lead, by ticket kind, and
 * where that kind came from (`--kind`, the ticket title, or the implement default).
 */
export type GameLaunchChosenBy = {
  by: 'lead'
  kind: GameTicketKind
  source: (typeof GAME_LAUNCH_KIND_SOURCES)[number]
}

/** The Claude model and effort a member starts on for its ticket's kind. */
export type GameKindLaunch = { kind: GameTicketKind; model: string; effort: string }

/** The one kind table: game launch reads it now, ORCA-1242's steward reads it as each phase's default. */
export const GAME_KIND_LAUNCH: Readonly<Record<GameTicketKind, Omit<GameKindLaunch, 'kind'>>> = {
  audit: { model: 'claude-sonnet-5-5', effort: 'medium' },
  implement: { model: 'claude-opus-5-5', effort: 'high' },
  review: { model: 'claude-opus-5-5', effort: 'high' },
  captures: { model: 'claude-sonnet-5-5', effort: 'medium' }
}

// Why only clear words (lead, 2026-11-15): anything else, or two kinds at once, launches as implement.
const KIND_WORDS: readonly [GameTicketKind, RegExp][] = [
  ['audit', /\b(audit|investigate)\b/i],
  ['review', /\breview\b/i],
  ['captures', /\b(captures?|screenshots?)\b/i]
]

/** The one kind a ticket's title clearly names, or null when it names none or several. */
export function gameTicketKindOf(title: string): GameTicketKind | null {
  const named = KIND_WORDS.filter(([, words]) => words.test(title))
  return named.length === 1 ? named[0]![0] : null
}

export function parseGameTicketKind(value: string): GameTicketKind | null {
  const kind = value.trim().toLowerCase()
  return GAME_TICKET_KINDS.find((one) => one === kind) ?? null
}

/** The launch for a kind; an unknown kind starts as implementation, so a wrong guess costs tokens, not quality. */
export function gameKindLaunchOf(kind: GameTicketKind | null): GameKindLaunch {
  const known = kind ?? 'implement'
  return { kind: known, ...GAME_KIND_LAUNCH[known] }
}

/** The lead's choice for a launch: `--kind` when passed, else the title's kind, else the default. */
export function gameLaunchChosenByOf(
  flagKind: GameTicketKind | null,
  title: string
): GameLaunchChosenBy {
  if (flagKind) {
    return { by: 'lead', kind: flagKind, source: 'flag' }
  }
  const inferred = gameTicketKindOf(title)
  return inferred
    ? { by: 'lead', kind: inferred, source: 'ticket' }
    : { by: 'lead', kind: 'implement', source: 'default' }
}
