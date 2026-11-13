import { z } from 'zod'
import { GAME_PANEL_STYLES } from '../../../../shared/orchestrator-game-panel'
import { STATUS_COLOR_TONES, type StatusColorTone } from '../../../../shared/status-colors'

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb colour')

const StatusColorPaletteUpdate = z
  .object(
    Object.fromEntries(STATUS_COLOR_TONES.map((tone) => [tone, HexColor.optional()])) as Record<
      StatusColorTone,
      z.ZodOptional<typeof HexColor>
    >
  )
  .strict()

/** The fields a paired phone may set in settings.update; advertised by mobile.agent-teams-settings.v1. */
export const AgentTeamsSettingsUpdateFields = {
  // Why no look: the phone picks only the scene and its style; the look stays a desktop choice.
  agentTeamsPanel: z
    .object({
      scene: z.string().trim().min(1).max(200).optional(),
      style: z.enum(GAME_PANEL_STYLES).optional()
    })
    .strict()
    .optional(),
  statusColors: z
    .object({
      light: StatusColorPaletteUpdate.nullable().optional(),
      dark: StatusColorPaletteUpdate.nullable().optional()
    })
    .strict()
    .optional()
}
