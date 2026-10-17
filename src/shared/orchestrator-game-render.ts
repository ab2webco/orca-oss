/** How the game draws its scene: the 5-row pixel art, or the 9 to 10-row 2D-HD one. */
export type OrchestratorGameRender = 'classic' | 'hd'

export const ORCHESTRATOR_GAME_RENDERS: readonly OrchestratorGameRender[] = ['classic', 'hd']

/** The timezone value that follows the machine's own clock. */
export const ORCHESTRATOR_GAME_LOCAL_TIMEZONE = 'local'

export const ORCHESTRATOR_GAME_RENDER_WARNING = 'orchestratorGame.render must be classic or hd'

export const ORCHESTRATOR_GAME_TIMEZONE_WARNING =
  'orchestratorGame.timezone must be local or an IANA time zone such as America/Bogota'

export const isOrchestratorGameRender = (value: unknown): value is OrchestratorGameRender =>
  value === 'classic' || value === 'hd'

/** `local`, or a zone name the runtime's ICU knows. */
export const isOrchestratorGameTimezone = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.trim() === '') {
    return false
  }
  if (value === ORCHESTRATOR_GAME_LOCAL_TIMEZONE) {
    return true
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** The zone handed to the mod: `local` becomes this desktop's own, since an SSH host's clock is not the person's. */
export const desktopGameTimezoneOf = (
  timezone: string,
  desktopZone = Intl.DateTimeFormat().resolvedOptions().timeZone
): string => (timezone === ORCHESTRATOR_GAME_LOCAL_TIMEZONE && desktopZone ? desktopZone : timezone)

type LookKey = 'render' | 'timezone'

/** Checks one look key of a layer; an invalid value is dropped with its warning. */
export function lookFieldOf(
  key: LookKey,
  value: unknown
): { value: string; warning?: undefined } | { value?: undefined; warning: string } {
  if (key === 'render') {
    return isOrchestratorGameRender(value)
      ? { value }
      : { warning: ORCHESTRATOR_GAME_RENDER_WARNING }
  }
  return isOrchestratorGameTimezone(value)
    ? { value: value.trim() }
    : { warning: ORCHESTRATOR_GAME_TIMEZONE_WARNING }
}

export const isLookKey = (key: string): key is LookKey => key === 'render' || key === 'timezone'
