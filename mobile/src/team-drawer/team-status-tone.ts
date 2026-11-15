import { createContext, useContext } from 'react'
import type { StatusColorPalette, StatusColorTone } from '../../../src/shared/status-colors'
import type { TeamStatus } from '../../../src/shared/team-panel-model-types'
import { colors } from '../theme/mobile-theme'

/** One colour per status role, after the person's overrides. */
export type TeamTones = Record<StatusColorTone, string>

// Why the app's tokens, not STATUS_COLOR_DEFAULTS: with nothing overridden the phone draws as before.
export const TEAM_TONE_DEFAULTS: TeamTones = {
  attention: colors.statusRed,
  warning: colors.statusAmber,
  info: colors.statusGreen,
  success: colors.statusPurple,
  idle: colors.textMuted
}

export function teamTonesOf(dark: StatusColorPalette): TeamTones {
  return { ...TEAM_TONE_DEFAULTS, ...dark }
}

/** The desktop's role for each status (team-scene-status-colors.ts): working is info, done success. */
export const TEAM_STATUS_ROLE: Record<TeamStatus, StatusColorTone> = {
  attention: 'attention',
  failed: 'attention',
  risk: 'warning',
  working: 'info',
  done: 'success',
  idle: 'idle',
  closed: 'idle'
}

const TeamTonesContext = createContext<TeamTones>(TEAM_TONE_DEFAULTS)

export const TeamTonesProvider = TeamTonesContext.Provider

export const useTeamTones = (): TeamTones => useContext(TeamTonesContext)

/** Today's map, until each mark reads the person's tones from TeamTonesProvider. */
export const TEAM_STATUS_TONE: Record<TeamStatus, string> = {
  attention: TEAM_TONE_DEFAULTS.attention,
  failed: TEAM_TONE_DEFAULTS.attention,
  risk: TEAM_TONE_DEFAULTS.warning,
  working: TEAM_TONE_DEFAULTS.info,
  done: TEAM_TONE_DEFAULTS.success,
  idle: TEAM_TONE_DEFAULTS.idle,
  closed: TEAM_TONE_DEFAULTS.idle
}
