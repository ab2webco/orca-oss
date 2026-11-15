import type { TeamStatus } from '../../../src/shared/team-panel-model-types'
import { colors } from '../theme/mobile-theme'

/** The shared status language in the app's tokens: red, amber, green, purple for verified, grey. */
export const TEAM_STATUS_TONE: Record<TeamStatus, string> = {
  attention: colors.statusRed,
  failed: colors.statusRed,
  risk: colors.statusAmber,
  working: colors.statusGreen,
  done: colors.statusPurple,
  idle: colors.textMuted,
  closed: colors.textMuted
}
