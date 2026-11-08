import {
  parseGameActions,
  type OrchestratorGameAction
} from '../../../../shared/orchestrator-game-actions'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import {
  gameMachineActionsOf,
  isGameHiddenAction,
  parseGameMachineActions,
  withGameMachineActions,
  type GameMachineAction
} from '../../../../shared/orchestrator-game-machine-actions'

/** Where a project action is saved: orca.yaml, or this machine's settings. */
export type ActionScope = 'project' | 'machine'
export type ScopedLists = {
  project: OrchestratorGameAction[]
  machine: GameMachineAction[]
  /** An old whole-list override, not yet saved again: every row reads as this machine's, as before. */
  legacy?: true
}
export type ScopedRow = { action: OrchestratorGameAction; scope: ActionScope; overrides: boolean }

/** An old whole-list override reads as the changes it made, so the first save migrates it. */
export function scopedListsOf(
  project: OrchestratorGameAction[],
  local: OrchestratorGameLayer | undefined
): ScopedLists {
  const machine = parseGameMachineActions(local?.machineActions).value
  if (machine !== undefined || local?.actions === undefined) {
    return { project, machine: machine ?? [] }
  }
  return {
    project,
    machine: gameMachineActionsOf(project, parseGameActions(local.actions).value ?? []),
    legacy: true
  }
}

const sameCommand =
  (command: string | undefined) =>
  (one: { command?: string }): boolean =>
    command !== undefined && one.command === command

/** The merged list the panel shows, each row marked with the list it is stored in. */
export function scopedRowsOf({ project, machine, legacy }: ScopedLists): ScopedRow[] {
  return withGameMachineActions(project, machine).map((action) => {
    const stored = machine.some((one) => one === action || sameCommand(action.command)(one))
    return {
      action,
      scope: stored || legacy ? 'machine' : 'project',
      overrides: stored && project.some(sameCommand(action.command))
    }
  })
}

const without = <T extends { command?: string }>(list: readonly T[], command?: string): T[] =>
  list.filter((one) => !sameCommand(command)(one))

/** `from` is the row's action before the edit, null for a new action, which goes first. */
export function withSavedAction(
  { project, machine }: ScopedLists,
  action: OrchestratorGameAction,
  scope: ActionScope,
  from: OrchestratorGameAction | null
): ScopedLists {
  const isFrom = (one: GameMachineAction): boolean =>
    from !== null && (one === from || sameCommand(from.command)(one))
  if (scope === 'project') {
    const at = project.findIndex(isFrom)
    return {
      project:
        at === -1 ? [action, ...project] : project.map((one, i) => (i === at ? action : one)),
      machine: machine.filter((one) => !isFrom(one) && !sameCommand(action.command)(one))
    }
  }
  // Why hide the old command: renaming an orca.yaml action here must not show it twice.
  const renamed =
    from?.command !== undefined && from.command !== action.command && project.some(isFrom)
      ? [{ command: from.command, enabled: false as const }]
      : []
  const at = machine.findIndex((one) => !isGameHiddenAction(one) && isFrom(one))
  if (at !== -1) {
    const next = machine.flatMap((one, i) =>
      i === at ? [action] : sameCommand(action.command)(one) ? [] : [one]
    )
    return { project, machine: [...next, ...renamed] }
  }
  const rest = without(machine, action.command)
  return { project, machine: from === null ? [action, ...rest] : [...rest, action, ...renamed] }
}

/** On orca.yaml it goes for everyone; on this machine an orca.yaml action is hidden here only. */
export function withRemovedAction(
  { project, machine }: ScopedLists,
  action: OrchestratorGameAction,
  scope: ActionScope
): ScopedLists {
  const rest = machine.filter((one) => one !== action && !sameCommand(action.command)(one))
  if (scope === 'project' || action.command === undefined) {
    return {
      project: project.filter((one) => one !== action && !sameCommand(action.command)(one)),
      machine: rest
    }
  }
  const inProject = project.some(sameCommand(action.command))
  return {
    project,
    machine: inProject ? [...rest, { command: action.command, enabled: false }] : rest
  }
}

const swapped = <T>(list: readonly T[], a: T, b: T): T[] =>
  list.map((one) => (one === a ? b : one === b ? a : one))

/** Null when the row above is stored elsewhere: orca.yaml's order comes first, then this machine's. */
export function withMovedUp(lists: ScopedLists, index: number): ScopedLists | null {
  const rows = scopedRowsOf(lists)
  const row = rows[index]
  const above = rows[index - 1]
  if (!row || !above || row.overrides) {
    return null
  }
  if (row.scope === 'project') {
    const theirs = lists.project.find(sameCommand(above.action.command)) ?? above.action
    return above.scope === 'project' || above.overrides
      ? { ...lists, project: swapped(lists.project, row.action, theirs) }
      : null
  }
  return above.scope === 'machine' && !above.overrides
    ? { ...lists, machine: swapped(lists.machine, row.action, above.action) }
    : null
}
