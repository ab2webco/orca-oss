/** A project's persistent STOP: while set, nothing is launched or pushed until `orca game resume`. */
export type GameStop = {
  since: string | null
  by: string | null
  /** Its state could not be read, so it counts as set. */
  unreadable?: true
}

export const UNREADABLE_GAME_STOP: GameStop = { since: null, by: null, unreadable: true }

const BY_MAX = 120

/** A STOP as read from disk or the wire; anything malformed fails closed. */
export function parseGameStop(raw: unknown): GameStop {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return UNREADABLE_GAME_STOP
  }
  const { since, by } = raw as Record<string, unknown>
  if (typeof since !== 'string' || Number.isNaN(Date.parse(since))) {
    return UNREADABLE_GAME_STOP
  }
  return { since, by: typeof by === 'string' ? by.slice(0, BY_MAX) : null }
}

/** `STOP since … (by lead)`, or why an unreadable one counts as set. */
export function gameStopLabel(stop: GameStop): string {
  return stop.unreadable
    ? 'STOP (its STOP state cannot be read, so it counts as set)'
    : `STOP${stop.since ? ` since ${stop.since}` : ''}${stop.by ? ` (by ${stop.by})` : ''}`
}

export function gameStopRefusal(stop: GameStop, what: string): string {
  return `The project is on ${gameStopLabel(stop)}: ${what} is refused until \`orca game resume\`.`
}

/** Reads STOP for `game state`; a read that fails counts as set, with a warning naming why. */
export async function settleGameStop(
  read: () => Promise<GameStop | null>
): Promise<{ stopped: GameStop | null; warning: string | null }> {
  try {
    return { stopped: await read(), warning: null }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      stopped: UNREADABLE_GAME_STOP,
      warning: `STOP cannot be read (${reason}); it counts as set`
    }
  }
}
