import type { GameLead, GameRole, GameState } from '../types'

/** The plugin skill that loads the lead's standing rules from `orca game lead`. */
export const LEAD_SKILL = 'orca-game:lead'

// Mirrors Orca's own limits in src/shared/orchestrator-game-lead.ts.
const DEFAULT_CAP = 4
const CAP_MAX = 12
const LABEL_MAX = 32

type Shape = Record<string, unknown>

const isShape = (value: unknown): value is Shape =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const leadOf = (value: Shape): GameLead => {
  const cap = value.cap
  const label = typeof value.label === 'string' ? value.label.trim() : ''
  return {
    autostart: value.autostart === true,
    cap:
      typeof cap === 'number' && Number.isInteger(cap) && cap >= 1 && cap <= CAP_MAX
        ? cap
        : DEFAULT_CAP,
    ...(label !== '' && label.length <= LABEL_MAX ? { label } : {})
  }
}

/** The project's lead and the calling pane's role; each absent when the host sends none. */
export const gameLeadOf = (body: Shape): { lead?: GameLead; role?: GameRole } => ({
  ...(isShape(body.lead) ? { lead: leadOf(body.lead) } : {}),
  ...(body.role === 'lead' || body.role === 'member' ? { role: body.role } : {})
})

/** Only the lead of a project that asks for it; a member reports to its lead and never leads. */
export const isLeadAutostart = (state: Pick<GameState, 'lead' | 'role'>): boolean =>
  state.role === 'lead' && state.lead?.autostart === true
