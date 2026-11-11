import type { GameAction, GameActionIcon } from './orchestrator-game-actions'
import { gamePushPlanOf, gameSweepOf, gameWavePlanOf } from './orchestrator-game-fleet-verbs'
import { GAME_ORCA_ACTION_IDS, type GameOrcaActionId } from './orchestrator-game-orca-actions'
import type { OrchestratorGameState } from './orchestrator-game-state'

/** Why an action cannot run now; each client words it. */
export type TeamActionOff =
  | 'stopped'
  | 'nothingToDo'
  | 'nobodyStopped'
  | 'nothingToClose'
  | 'alreadyStopped'
  | 'noNativePath'

export type TeamAction = {
  /** The id game.state gives it: `lead:wave`, `action-0`. */
  id: string
  /** Which of Orca's own actions this is; null for the project's. */
  orca: GameOrcaActionId | null
  /** As the host sent it; a client words Orca's own when the project kept the default. */
  label: string
  icon: GameActionIcon | null
  /** Its slash command in the lead pane, which the menu shows; null when it has none. */
  command: string | null
  pin: boolean
  /** What the panel sends the lead as a turn; null when only the terminal can run it. */
  send: string | null
  /** Set while it applies, with the fleet count it acts on. */
  now: { count: number } | null
  off: TeamActionOff | null
}

// Why here too: a host older than ORCA-1093 sends Orca's actions without an icon.
const ORCA_ICONS: Record<GameOrcaActionId, GameActionIcon> = {
  wave: 'launch',
  status: 'pulse',
  push: 'play',
  sweep: 'check',
  stop: 'stop'
}

const orcaIdOf = (id: string): GameOrcaActionId | null => {
  const name = id.startsWith('lead:') ? id.slice('lead:'.length) : ''
  return (GAME_ORCA_ACTION_IDS as readonly string[]).includes(name)
    ? (name as GameOrcaActionId)
    : null
}

// Why a slash command for MCP: the mod registers `/<command>` in the lead pane and runs the tool.
const sendOf = (action: GameAction): string | null =>
  'prompt' in action ? action.prompt : action.command ? `/${action.command}` : null

/** Members whose agent is still at work or waiting on the user; a launch STOP leaves them running. */
export function gameMembersRunningOf(state: Pick<OrchestratorGameState, 'agents'>): number {
  return (state.agents ?? []).filter(
    (agent) => agent.isMember === true && (agent.state === 'working' || agent.state === 'waiting')
  ).length
}

/** When each of Orca's actions applies, from one game.state read; the rest always may run. */
function orcaStateOf(
  orca: GameOrcaActionId,
  state: OrchestratorGameState
): Pick<TeamAction, 'now' | 'off'> {
  const stopped = state.stopped !== null && state.stopped !== undefined
  const counted = (count: number, off: TeamActionOff): Pick<TeamAction, 'now' | 'off'> =>
    count > 0 ? { now: { count }, off: null } : { now: null, off }
  switch (orca) {
    case 'wave':
      return stopped
        ? { now: null, off: 'stopped' }
        : counted(gameWavePlanOf(state, []).launch.length, 'nothingToDo')
    case 'push':
      return counted(
        gamePushPlanOf(state).filter((one) => one.action === 'push').length,
        'nobodyStopped'
      )
    case 'sweep':
      return stopped
        ? { now: null, off: 'stopped' }
        : counted(gameSweepOf(state).length, 'nothingToClose')
    case 'stop':
      // Why: STOP pauses launches and pushes only; Stop must still reach members that run (ORCA-1157).
      return {
        now: null,
        off: stopped && gameMembersRunningOf(state) === 0 ? 'alreadyStopped' : null
      }
    case 'status':
      return { now: null, off: null }
  }
}

export function teamActionsOf(state: OrchestratorGameState): TeamAction[] {
  return (state.actions ?? []).map((action) => {
    const orca = orcaIdOf(action.id)
    const send = sendOf(action)
    const when: Pick<TeamAction, 'now' | 'off'> = orca
      ? orcaStateOf(orca, state)
      : { now: null, off: send === null ? 'noNativePath' : null }
    return {
      id: action.id,
      orca,
      label: action.label,
      icon: action.icon ?? (orca ? ORCA_ICONS[orca] : null),
      command: action.command ?? null,
      pin: action.pin === true,
      send,
      ...when
    }
  })
}

/** The dock's chips: what applies now in Orca's order, then pinned project ones, `fresh` first. */
export function teamDockActionsOf(
  actions: readonly TeamAction[],
  fresh: string | null
): TeamAction[] {
  const now = actions.filter((one) => one.now !== null && one.orca !== 'stop')
  const pinned = actions
    .filter((one) => one.orca === null && one.pin)
    .sort((a, b) => Number(b.id === fresh) - Number(a.id === fresh))
  return [...now, ...pinned]
}
