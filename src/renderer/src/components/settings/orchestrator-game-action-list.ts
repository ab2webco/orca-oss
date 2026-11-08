import {
  GAME_ACTION_COMMAND,
  GAME_ACTION_PINS_MAX,
  type GameActionIcon
} from '../../../../shared/orchestrator-game-actions'
import { GAME_LEAD_ACTIONS } from '../../../../shared/orchestrator-game-lead-actions'
import {
  parseGameOrcaActions,
  type GameOrcaActionId,
  type OrchestratorGameOrcaActions
} from '../../../../shared/orchestrator-game-orca-actions'
import type { ActionDraft } from './orchestrator-game-action-drafts'

/** The icons V30's picker offers; Orca's play, check and stop stay its own. */
export const GAME_ACTION_PICKER_ICONS: readonly GameActionIcon[] = [
  'ship',
  'flask',
  'tag',
  'review',
  'scan',
  'list',
  'pulse',
  'launch'
]

/** The command a name suggests until the person types one: V30's slug, as orca.yaml accepts it. */
export function actionCommandOf(label: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 24)
    .replace(/-+$/, '')
  return GAME_ACTION_COMMAND.test(slug) ? slug : ''
}

const pinnedCount = (drafts: readonly ActionDraft[]): number =>
  drafts.filter((one) => one.pin).length

/** New actions go first, pinned while the panel row has room. */
export function withNewActionFirst(
  drafts: readonly ActionDraft[],
  draft: ActionDraft
): ActionDraft[] {
  return [{ ...draft, pin: pinnedCount(drafts) < GAME_ACTION_PINS_MAX }, ...drafts]
}

export function movedUp(drafts: ActionDraft[], index: number): ActionDraft[] {
  if (index <= 0 || index >= drafts.length) {
    return drafts
  }
  const next = [...drafts]
  ;[next[index - 1], next[index]] = [next[index]!, next[index - 1]!]
  return next
}

/** 'full' when pinning one more would pass the row's limit. */
export function withPinToggled(drafts: ActionDraft[], index: number): ActionDraft[] | 'full' {
  const target = drafts[index]
  if (!target) {
    return drafts
  }
  if (!target.pin && pinnedCount(drafts) >= GAME_ACTION_PINS_MAX) {
    return 'full'
  }
  return drafts.map((one, at) => (at === index ? { ...one, pin: !one.pin } : one))
}

export type OrcaActionRow = {
  id: GameOrcaActionId
  label: string
  icon: GameActionIcon
  prompt: string
  enabled: boolean
}

// Why this order: V30 lists Orca's by when they apply, with Status and Stop last.
const ORCA_ROW_ORDER: readonly GameOrcaActionId[] = ['wave', 'push', 'sweep', 'status', 'stop']

/** Orca's actions as orca.yaml and then this machine change them; stop can never be off. */
export function orcaActionRowsOf(
  project: OrchestratorGameOrcaActions | undefined,
  local: OrchestratorGameOrcaActions | undefined
): OrcaActionRow[] {
  return ORCA_ROW_ORDER.map((id) => {
    const base = GAME_LEAD_ACTIONS.find((one) => one.command === id)!
    const change = { ...project?.[id], ...local?.[id] }
    return {
      id,
      label: change.label ?? base.label,
      icon: change.icon ?? base.icon ?? 'pulse',
      prompt: change.prompt ?? ('prompt' in base ? base.prompt : ''),
      enabled: id === 'stop' || change.enabled !== false
    }
  })
}

function cleaned(actions: OrchestratorGameOrcaActions): OrchestratorGameOrcaActions | undefined {
  const kept = Object.entries(actions).filter(([, entry]) => Object.keys(entry ?? {}).length > 0)
  return kept.length === 0 ? undefined : (Object.fromEntries(kept) as OrchestratorGameOrcaActions)
}

/** This machine's switch for one of Orca's actions; on again drops back to orca.yaml's. */
export function withOrcaEnabled(
  local: OrchestratorGameOrcaActions | undefined,
  project: OrchestratorGameOrcaActions | undefined,
  id: GameOrcaActionId,
  enabled: boolean
): OrchestratorGameOrcaActions | undefined {
  const entry = { ...local?.[id] }
  if (enabled && project?.[id]?.enabled !== false) {
    delete entry.enabled
  } else {
    entry.enabled = enabled
  }
  return cleaned({ ...local, [id]: entry })
}

/** This machine's words for one of Orca's actions, keeping only what differs from Orca's own. */
export function withOrcaWords(
  local: OrchestratorGameOrcaActions | undefined,
  id: GameOrcaActionId,
  draft: Pick<ActionDraft, 'label' | 'icon' | 'prompt'>
): OrchestratorGameOrcaActions | undefined | 'label' | 'prompt' {
  const base = GAME_LEAD_ACTIONS.find((one) => one.command === id)!
  const { enabled } = local?.[id] ?? {}
  const label = draft.label.trim()
  const prompt = draft.prompt.trim()
  const entry = {
    ...(enabled === undefined ? {} : { enabled }),
    ...(label !== base.label ? { label } : {}),
    ...(draft.icon && draft.icon !== base.icon ? { icon: draft.icon } : {}),
    ...('prompt' in base && prompt !== base.prompt ? { prompt } : {})
  }
  const warning = parseGameOrcaActions({ [id]: entry }).warnings[0]
  if (warning !== undefined) {
    return warning.includes('.label') ? 'label' : 'prompt'
  }
  return cleaned({ ...local, [id]: entry })
}

/** V30 says a command clash before a missing prompt; Orca's own commands count as taken too. */
export function isCommandTaken(
  drafts: readonly ActionDraft[],
  editing: number | 'new',
  command: string
): boolean {
  return (
    GAME_LEAD_ACTIONS.some((one) => one.command === command) ||
    drafts.some((one, at) => at !== editing && one.command.trim() === command)
  )
}
