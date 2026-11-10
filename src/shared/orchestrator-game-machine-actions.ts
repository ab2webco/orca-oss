import {
  GAME_ACTIONS_MAX,
  GAME_ACTION_COMMAND,
  GAME_ACTION_PINS_MAX,
  parseGameActions,
  type OrchestratorGameAction
} from './orchestrator-game-actions'

/** This machine's change to the project's actions, keyed by command: its own version, or hidden here. */
export type GameMachineAction = OrchestratorGameAction | GameHiddenAction
export type GameHiddenAction = { command: string; enabled: false }

export const isGameHiddenAction = (one: GameMachineAction): one is GameHiddenAction =>
  'enabled' in one && one.enabled === false

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Hidden entries come last: their order means nothing, the others' order is the row's. */
export function parseGameMachineActions(raw: unknown): {
  value: GameMachineAction[] | undefined
  warnings: string[]
} {
  if (raw === undefined || raw === null) {
    return { value: undefined, warnings: [] }
  }
  if (!Array.isArray(raw)) {
    return { value: undefined, warnings: ['orchestratorGame.machineActions must be a list'] }
  }
  const hidden: GameHiddenAction[] = []
  const warnings: string[] = []
  const actions = raw.filter((entry, index) => {
    if (!isRecord(entry) || entry.enabled !== false) {
      return true
    }
    if (typeof entry.command === 'string' && GAME_ACTION_COMMAND.test(entry.command)) {
      hidden.push({ command: entry.command, enabled: false })
    } else {
      warnings.push(`orchestratorGame.machineActions[${index}] hides an action by its command`)
    }
    return false
  })
  const parsed = parseGameActions(actions)
  return {
    value: [...(parsed.value ?? []), ...hidden],
    warnings: [...warnings, ...parsed.warnings]
  }
}

/** orca.yaml's actions first, each replaced or hidden by this machine's entry for its command, then
 *  this machine's own; the panel's caps apply to the result. */
export function withGameMachineActions(
  project: readonly OrchestratorGameAction[],
  machine: readonly GameMachineAction[]
): OrchestratorGameAction[] {
  const mine = new Map(machine.map((one) => [one.command, one]))
  const merged = project.flatMap((action) => {
    const change = action.command === undefined ? undefined : mine.get(action.command)
    if (change === undefined) {
      return [action]
    }
    return isGameHiddenAction(change) ? [] : [change]
  })
  const taken = new Set(project.map((action) => action.command))
  const added = machine.filter(
    (one): one is OrchestratorGameAction =>
      !isGameHiddenAction(one) && (one.command === undefined || !taken.has(one.command))
  )
  let pins = 0
  return [...merged, ...added]
    .slice(0, GAME_ACTIONS_MAX)
    .map((action) =>
      action.pin === true && ++pins > GAME_ACTION_PINS_MAX ? { ...action, pin: false } : action
    )
}

// Why sorted keys: orca.yaml and Settings write the same action with its keys in different orders.
const canonical = (action: Record<string, unknown>): string =>
  JSON.stringify({ ...action, pin: action.pin === true }, (_key, value: unknown) =>
    isRecord(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
      : value
  )

/** The same action whatever its key order, an unset pin counting as off. */
export const isSameGameAction = (raw: unknown, action: OrchestratorGameAction): boolean =>
  isRecord(raw) && canonical(raw) === canonical(action)

/** An old machine `actions` list, which replaced orca.yaml's whole, as only the changes it made. */
export function gameMachineActionsOf(
  project: readonly OrchestratorGameAction[],
  old: readonly OrchestratorGameAction[]
): GameMachineAction[] {
  const kept = new Set(old.map((action) => action.command))
  const changed = old.flatMap((action) => {
    const theirs = project.find(
      (one) => one.command !== undefined && one.command === action.command
    )
    if (theirs === undefined) {
      return [action]
    }
    // Why: a copy written before pins has no pin key; it takes orca.yaml's rather than unpinning.
    const mine =
      action.pin === undefined && theirs.pin !== undefined ? { ...action, pin: theirs.pin } : action
    return isSameGameAction(theirs, mine) ? [] : [mine]
  })
  const hidden = project.flatMap((action): GameHiddenAction[] =>
    action.command === undefined || kept.has(action.command)
      ? []
      : [{ command: action.command, enabled: false }]
  )
  return [...changed, ...hidden]
}
