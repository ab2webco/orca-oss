import { GAME_PROMPT_MAX, gameActionIconOf, type GameActionIcon } from './orchestrator-game-actions'
import { GAME_LINK_LABEL_MAX } from './orchestrator-game-integrations'

/** Orca's own lead buttons, by the command each keeps whatever the project renames it to. */
export const GAME_ORCA_ACTION_IDS = ['wave', 'status', 'push', 'sweep', 'stop'] as const
export type GameOrcaActionId = (typeof GAME_ORCA_ACTION_IDS)[number]

/** What a project may change on one of Orca's buttons; its command is fixed. */
export type GameOrcaActionOverride = {
  enabled?: boolean
  label?: string
  icon?: GameActionIcon
  prompt?: string
}

export type OrchestratorGameOrcaActions = Partial<Record<GameOrcaActionId, GameOrcaActionOverride>>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isOrcaActionId = (value: string): value is GameOrcaActionId =>
  (GAME_ORCA_ACTION_IDS as readonly string[]).includes(value)

function parseOverride(
  id: GameOrcaActionId,
  raw: Record<string, unknown>,
  at: string,
  warnings: string[]
): GameOrcaActionOverride {
  const override: GameOrcaActionOverride = {}
  if (raw.command !== undefined) {
    warnings.push(`${at}.command is fixed`)
  }
  if (raw.icon !== undefined) {
    const icon = gameActionIconOf(raw.icon, `${at}.icon`)
    if (typeof icon === 'string') {
      override.icon = icon
    } else {
      warnings.push(icon.warning)
    }
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    warnings.push(`${at}.enabled must be true or false`)
  } else if (raw.enabled === false && id === 'stop') {
    warnings.push(`${at} cannot be turned off`)
  } else if (raw.enabled !== undefined) {
    override.enabled = raw.enabled
  }
  if (raw.label !== undefined) {
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    if (label.length === 0 || label.length > GAME_LINK_LABEL_MAX) {
      warnings.push(`${at}.label must be 1 to ${GAME_LINK_LABEL_MAX} characters`)
    } else {
      override.label = label
    }
  }
  if (raw.prompt !== undefined) {
    const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : ''
    // Why no placeholders: Orca's buttons are the lead's, with no worktree to fill them from.
    if (prompt.length === 0 || prompt.length > GAME_PROMPT_MAX) {
      warnings.push(`${at}.prompt must be 1 to ${GAME_PROMPT_MAX} characters`)
    } else if (/\{[^{}]*\}/.test(prompt)) {
      warnings.push(`${at}.prompt cannot use placeholders`)
    } else {
      override.prompt = prompt
    }
  }
  return override
}

export function parseGameOrcaActions(raw: unknown): {
  value: OrchestratorGameOrcaActions | undefined
  warnings: string[]
} {
  if (raw === undefined || raw === null) {
    return { value: undefined, warnings: [] }
  }
  if (!isRecord(raw)) {
    return { value: undefined, warnings: ['orchestratorGame.orcaActions must be a mapping'] }
  }
  const value: OrchestratorGameOrcaActions = {}
  const warnings: string[] = []
  for (const [id, entry] of Object.entries(raw)) {
    const at = `orchestratorGame.orcaActions.${id}`
    if (!isOrcaActionId(id)) {
      warnings.push(`${at} is not an Orca action: ${GAME_ORCA_ACTION_IDS.join(', ')}`)
    } else if (!isRecord(entry)) {
      warnings.push(`${at} must be a mapping`)
    } else {
      value[id] = parseOverride(id, entry, at, warnings)
    }
  }
  return { value, warnings }
}

/** Layers in order; a later layer wins field by field. */
export function mergeGameOrcaActions(
  layers: readonly (OrchestratorGameOrcaActions | undefined)[]
): OrchestratorGameOrcaActions {
  const merged: OrchestratorGameOrcaActions = {}
  for (const layer of layers) {
    for (const id of GAME_ORCA_ACTION_IDS) {
      if (layer?.[id] !== undefined) {
        merged[id] = { ...merged[id], ...layer[id] }
      }
    }
  }
  return merged
}
