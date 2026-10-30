import type { GameLead, GameState } from '../types'
import { hostCapacityOf } from './host-capacity'

/** The plugin skill that loads the lead's standing rules from `orca game lead`. */
export const LEAD_SKILL = 'orca-game:lead'

// Mirrors Orca's own limits in src/shared/orchestrator-game-lead.ts; a lead's cap sums its hosts', so it has no max.
const DEFAULT_CAP = 4
const LABEL_MAX = 32

type Shape = Record<string, unknown>

const isShape = (value: unknown): value is Shape =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const leadOf = (value: Shape): GameLead => {
  const cap = value.cap
  const label = typeof value.label === 'string' ? value.label.trim() : ''
  return {
    autostart: value.autostart === true,
    cap: typeof cap === 'number' && Number.isInteger(cap) && cap >= 1 ? cap : DEFAULT_CAP,
    ...(label !== '' && label.length <= LABEL_MAX ? { label } : {})
  }
}

/** The project's lead, the calling pane's role and the lead's hosts; each absent when the host sends none. */
export const gameLeadOf = (
  body: Shape
): Pick<GameState, 'lead' | 'role' | 'leadElsewhere' | 'hostCapacity'> => ({
  ...(isShape(body.lead) ? { lead: leadOf(body.lead) } : {}),
  ...hostCapacityOf(body),
  ...(body.role === 'lead' || body.role === 'member' ? { role: body.role } : {}),
  ...(isShape(body.leadElsewhere) && typeof body.leadElsewhere.handle === 'string'
    ? { leadElsewhere: { handle: body.leadElsewhere.handle } }
    : {})
})

/** Only the lead of a project that asks for it, and none while another pane leads it. */
export const isLeadAutostart = (
  state: Pick<GameState, 'lead' | 'role' | 'leadElsewhere'>
): boolean =>
  state.role === 'lead' && state.lead?.autostart === true && state.leadElsewhere === undefined

/** The crown's name in the Panel: the project's label, else the plain word. */
export const leadTitleOf = (state: Pick<GameState, 'lead'>, fallback: string): string =>
  state.lead?.label ?? fallback

/** What the mod last did to this session's name, kept in the store per session. */
export type LeadNameRecord = { applied?: string; isPersonNamed?: boolean }

/** The name to give a started lead session now, or null: never a member or a name the person chose. */
export const leadRenameOf = (args: {
  state: Pick<GameState, 'lead' | 'role'>
  isStarted: boolean
  record: LeadNameRecord | undefined
}): string | null => {
  const label = args.state.lead?.label
  if (args.state.role !== 'lead' || !args.isStarted || label === undefined) {
    return null
  }
  if (args.record?.isPersonNamed === true || args.record?.applied === label) {
    return null
  }
  return label
}
