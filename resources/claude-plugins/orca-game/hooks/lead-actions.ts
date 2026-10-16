import type { GameAction, GameState } from '../types'
import type { Chip } from './chip-rows'
import { gameStrings, type LeadActionKey } from './game-strings'

const LEAD_PREFIX = 'lead:'

const isLeadKey = (key: string): key is LeadActionKey => key in gameStrings().text.leadActions

/** Orca's own buttons in the session language; a project's keep the label it wrote. */
export const actionLabelOf = (action: Pick<GameAction, 'id' | 'label'>): string => {
  const key = action.id.startsWith(LEAD_PREFIX) ? action.id.slice(LEAD_PREFIX.length) : ''
  return isLeadKey(key) ? gameStrings().text.leadActions[key] : action.label
}

export const ACTION_CHIP_PREFIX = 'band-action-'

/** One band chip per action, in Orca's order, so the later ones are the first to give way. */
export const actionChipsOf = (actions: readonly GameAction[]): Chip[] =>
  actions.map((action, at) => {
    const label = actionLabelOf(action)
    return { key: `${ACTION_CHIP_PREFIX}${action.id}`, priority: at, labels: [`▸ ${label}`, label] }
  })

/** What `/wave CIN-1,CIN-2` sends: the action's prompt, then what the person typed after it. */
export const commandPromptOf = (prompt: string, args: string): string => {
  const extra = args.trim()
  return extra === '' ? prompt : `${prompt}\n\n${extra}`
}

/** The action Orca says the To Do link runs, when the state still has it. */
export const todoActionOf = (
  state: Pick<GameState, 'actions' | 'project'>
): GameAction | undefined => {
  const id = state.project?.todo?.actionId
  return id === undefined ? undefined : state.actions?.find((one) => one.id === id)
}
