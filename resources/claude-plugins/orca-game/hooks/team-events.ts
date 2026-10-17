import type { GameState } from '../types'
import { gameStrings } from './game-strings'
import type { TeamEvent } from './hd-overlay'
import { needsOf } from './party'

// What changed between two refreshes that the hd scene acts out. The first refresh of a session plays
// nothing: a CI red for hours or a teammate long waiting is not news.

const redCiCountOf = (state: GameState): number =>
  needsOf(state).filter((one) => one.text === gameStrings().text.ciFailingNeed).length

const waitingOf = (state: GameState): string[] =>
  state.agents
    .filter((agent) => !agent.isLeader && agent.state === 'waiting')
    .map((agent) => agent.displayName)

export const teamEventsOf = (
  before: GameState | null,
  next: GameState
): { kind: TeamEvent['kind']; text: string }[] => {
  if (before === null) {
    return []
  }
  const art = gameStrings().art
  const wasWaiting = waitingOf(before)
  const newlyWaiting = waitingOf(next).find((name) => !wasWaiting.includes(name))
  return [
    ...(redCiCountOf(next) > redCiCountOf(before)
      ? [{ kind: 'fail' as const, text: art.ciIsRed }]
      : []),
    ...(newlyWaiting === undefined
      ? []
      : [{ kind: 'needs' as const, text: art.alert(newlyWaiting) }])
  ]
}
