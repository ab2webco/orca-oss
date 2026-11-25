import { isFreshNonDoneAgentStatus } from './agent-status-types'
import { isFinishedMember } from './orchestrator-game-member-finished'
import type { GameAgent } from './orchestrator-game-state'

/** `unknown`: no fresh hook proves its state; `asleep`: a restart slept its pane (ORCA-1395). */
export type GameMemberPhase =
  | 'needs-you'
  | 'limited'
  | 'unknown'
  | 'working'
  | 'asleep'
  | 'idle'
  | 'finished'

const PHASES: readonly GameMemberPhase[] = [
  'needs-you',
  'limited',
  'unknown',
  'working',
  'asleep',
  'idle',
  'finished'
]

// Why the sidebar's gate: a hook stream that went silent proves no turn still runs.
const isUnprovenState = (agent: GameAgent, now: number): boolean =>
  agent.restored === true ||
  (agent.state === 'working' &&
    agent.hookAt !== undefined &&
    !isFreshNonDoneAgentStatus({ state: 'working', updatedAt: agent.hookAt }, now))

export function memberPhaseOf(agent: GameAgent, now = Date.now()): GameMemberPhase {
  if (isFinishedMember(agent)) {
    return 'finished'
  }
  if (agent.limit?.loggedOut) {
    return 'needs-you'
  }
  if (agent.limit) {
    return 'limited'
  }
  if (agent.remote?.asleep || agent.asleepHandle) {
    return 'asleep'
  }
  if (agent.state === 'waiting') {
    return 'needs-you'
  }
  if (isUnprovenState(agent, now)) {
    return 'unknown'
  }
  return agent.state === 'working' ? 'working' : 'idle'
}

/** Items in phase order, keeping their own order within a phase. */
export const byPhase = <T>(items: T[], phaseOf: (item: T) => GameMemberPhase): T[] =>
  items
    .map((item, index) => ({ item, index, rank: PHASES.indexOf(phaseOf(item)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item)
