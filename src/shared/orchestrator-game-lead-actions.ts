import type { GameAction } from './orchestrator-game-actions'
import type { OrchestratorGameLead } from './orchestrator-game-lead'
import type {
  GameOrcaActionId,
  OrchestratorGameOrcaActions
} from './orchestrator-game-orca-actions'

/** Orca's own lead buttons; each asks the lead, in words, to run one of its `game` verbs. */
export const GAME_LEAD_ACTIONS: readonly GameAction[] = [
  {
    id: 'lead:wave',
    label: 'Wave',
    command: 'wave',
    icon: 'launch',
    prompt:
      'Run a wave now: fill every free member slot from my To Do with `game wave`, then tell me what you launched.'
  },
  {
    id: 'lead:status',
    label: 'Status',
    command: 'status',
    icon: 'pulse',
    prompt: 'How are the members doing? Use `game fleet` and answer briefly.'
  },
  {
    id: 'lead:push',
    label: 'Push',
    command: 'push',
    icon: 'play',
    prompt: 'Resume the members that stopped with `game push`; tell me only what needs me.'
  },
  {
    id: 'lead:sweep',
    label: 'Sweep',
    command: 'sweep',
    icon: 'check',
    prompt:
      'Sweep the finished members: verify each with `game sweep`, then close them with `game sweep --close`.'
  },
  {
    id: 'lead:stop',
    label: 'Stop',
    command: 'stop',
    icon: 'stop',
    prompt:
      'Stop every member now and hold the STOP with `game stop --all --hold`; confirm, and resume only when I say so.'
  }
]

/** What `game.state` sends: the lead's built-in buttons unless turned off, then the project's. */
export function gameStateActionsOf(args: {
  role: 'lead' | 'member'
  lead: Pick<OrchestratorGameLead, 'actions'>
  project: readonly GameAction[]
  orca?: OrchestratorGameOrcaActions
}): GameAction[] {
  const builtIn = (
    args.role === 'lead' && args.lead.actions !== false ? GAME_LEAD_ACTIONS : []
  ).flatMap((one): GameAction[] => {
    const { enabled, ...look } = args.orca?.[one.command as GameOrcaActionId] ?? {}
    // Why stop stays: the parser refuses turning it off, and an older layer cannot skip that.
    return enabled === false && one.command !== 'stop' ? [] : [{ ...one, ...look }]
  })
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
