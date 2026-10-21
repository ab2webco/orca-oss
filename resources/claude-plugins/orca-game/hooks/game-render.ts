import type { GameConfig, GameRender } from '../types'

// Mirrors Orca's src/shared/orchestrator-game-render.ts, which the mod cannot import.

export const LOCAL_TIMEZONE = 'local'

export const isGameRender = (value: unknown): value is GameRender =>
  value === 'classic' || value === 'hd' || value === 'hd-compact'

export const isGameTimezone = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.trim() === '') {
    return false
  }
  if (value === LOCAL_TIMEZONE) {
    return true
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** The render and timezone of a raw config, each only when valid. */
export const lookConfigOf = (
  raw: Readonly<Record<string, unknown>>
): Partial<Pick<GameConfig, 'render' | 'timezone'>> => ({
  ...(isGameRender(raw.render) ? { render: raw.render } : {}),
  ...(isGameTimezone(raw.timezone) ? { timezone: raw.timezone } : {})
})
