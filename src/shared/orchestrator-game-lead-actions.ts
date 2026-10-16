import type { GameAction } from './orchestrator-game-actions'
import type { OrchestratorGameLead } from './orchestrator-game-lead'

/** Orca's own lead buttons; each asks the lead, in words, to run one of its `game` verbs. */
export const GAME_LEAD_ACTIONS: readonly GameAction[] = [
  {
    id: 'lead:wave',
    label: 'Wave',
    command: 'wave',
    prompt:
      'Run a wave now: fill every free member slot from my To Do with `game wave`, then tell me what you launched.'
  },
  {
    id: 'lead:status',
    label: 'Status',
    command: 'status',
    prompt: 'How are the members doing? Use `game fleet` and answer briefly.'
  },
  {
    id: 'lead:push',
    label: 'Push',
    command: 'push',
    prompt: 'Resume the members that stopped with `game push`; tell me only what needs me.'
  },
  {
    id: 'lead:sweep',
    label: 'Sweep',
    command: 'sweep',
    prompt:
      'Sweep the finished members: verify each with `game sweep`, then close them with `game sweep --close`.'
  },
  {
    id: 'lead:stop',
    label: 'Stop',
    command: 'stop',
    prompt: 'Stop every member now with `game stop --all` and confirm.'
  }
]

/** What `game.state` sends: the lead's built-in buttons unless turned off, then the project's. */
export function gameStateActionsOf(args: {
  role: 'lead' | 'member'
  lead: Pick<OrchestratorGameLead, 'actions'>
  project: readonly GameAction[]
}): GameAction[] {
  const builtIn = args.role === 'lead' && args.lead.actions !== false ? GAME_LEAD_ACTIONS : []
  const taken = new Set(builtIn.map((one) => one.command))
  // Why first wins: /wave stays Orca's while the project button keeps its place without it.
  const project = args.project.map((one) => {
    if (one.command === undefined || !taken.has(one.command)) {
      return one
    }
    const { command: _command, ...rest } = one
    return rest
  })
  return [...builtIn, ...project]
}

/** The PR and To Do lists' actions as `game.state` carries them, and a warning per unknown name. */
export function gameListActionsOf(
  actions: readonly GameAction[],
  names: { todo?: string; reviews?: string }
): { todo: { actionId?: string }; reviews: { actionId?: string }; warnings: string[] } {
  const warnings: string[] = []
  const idOf = (list: 'todo' | 'reviews'): { actionId?: string } => {
    const name = names[list]
    const id = name === undefined ? undefined : gameActionIdOf(actions, name)
    if (name !== undefined && id === undefined) {
      warnings.push(`orchestratorGame.${list}.action names no action: ${name}`)
    }
    return id === undefined ? {} : { actionId: id }
  }
  return { todo: idOf('todo'), reviews: idOf('reviews'), warnings }
}

/** The id of the action a setting names by its command or its id, as `todo.action` does. */
export const gameActionIdOf = (actions: readonly GameAction[], name: string): string | undefined =>
  (actions.find((one) => one.command === name) ?? actions.find((one) => one.id === name))?.id
