import { createContext, useContext } from 'react'
import type { StatusColorPalette, StatusColorTone } from '../../../src/shared/status-colors'
import type { GameAgent } from '../../../src/shared/orchestrator-game-state'
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

export const MEMBER_STATE_ROLE: Record<GameAgent['state'], StatusColorTone> = {
  waiting: 'attention',
  working: 'info',
  idle: 'idle',
  done: 'success'
}

const TeamTonesContext = createContext<TeamTones>(TEAM_TONE_DEFAULTS)

export const TeamTonesProvider = TeamTonesContext.Provider

export const useTeamTones = (): TeamTones => useContext(TeamTonesContext)
