import type { GameMemberLimit } from '../types'
import { gameStrings } from './game-strings'

// What a member card says about the account its agent runs on.

const isShape = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const memberLimitOf = (value: unknown): GameMemberLimit | undefined => {
  if (!isShape(value)) {
    return undefined
  }
  const resetsAt = value.resetsAt
  if (resetsAt === null) {
    return { resetsAt: null }
  }
  return typeof resetsAt === 'number' && Number.isFinite(resetsAt) ? { resetsAt } : undefined
}

/** "1h 30m" until `resetsAt`, rounded up to the minute; null when unknown or past. */
export const backInOf = (resetsAt: number | null, now: number): string | null => {
  if (resetsAt === null) {
    return null
  }
  const minutes = Math.ceil((resetsAt - now) / 60_000)
  if (minutes <= 0) {
    return null
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return [hours > 0 ? `${hours}h` : '', rest > 0 ? `${rest}m` : ''].filter(Boolean).join(' ')
}

export const limitTagOf = (limit: GameMemberLimit, now: number): string =>
  gameStrings().text.limited(backInOf(limit.resetsAt, now))
