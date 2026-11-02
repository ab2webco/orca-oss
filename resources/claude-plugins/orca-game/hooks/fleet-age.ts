import type { FleetState, GameLocale } from '../types'
import { gameLocale } from './game-strings'

// Why here: game-strings.ts is at its line cap, and only this note needs these words.
const STALE_FOR: Record<GameLocale, (age: string) => string> = {
  en: (age) => `updated ${age} ago · retrying`,
  es: (age) => `actualizado hace ${age} · reintentando`
}

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS

const ageOf = (ms: number): string => {
  if (ms < MINUTE_MS) {
    return `${Math.max(0, Math.floor(ms / SECOND_MS))} s`
  }
  return ms < HOUR_MS ? `${Math.floor(ms / MINUTE_MS)} min` : `${Math.floor(ms / HOUR_MS)} h`
}

/** The band's note: how old the drawn fleet is while reads fail, else the state's own note. */
export const fleetNoteOf = (v: FleetState, now: number): string =>
  v.isStale === true && v.state !== null && v.stateAt !== undefined
    ? STALE_FOR[gameLocale()](ageOf(now - v.stateAt))
    : v.note
