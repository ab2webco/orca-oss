import type { CommandHandler } from '../dispatch'
import { gameBoardCaller } from './orchestrator-game-board-call'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import { memberRosterOf, nextMemberName } from '../../shared/orchestrator-game-member-names'

type Client = Parameters<CommandHandler>[0]['client']

// Why the host picks: it sees every lead's members and holds the pick against a concurrent launch.
export async function memberNameFor(
  client: Client,
  state: OrchestratorGameState,
  ticket: string,
  taken: readonly string[]
): Promise<string | null> {
  const roster = memberRosterOf(state)
  const locale = process.env.ORCA_GAME_LOCALE ?? 'en'
  const reserved = await client
    .call<{ name?: unknown }>('game.memberNameReserve', {
      ...gameBoardCaller(),
      ticket,
      roster,
      locale,
      taken
    })
    .then(
      (response) => response.result,
      () => undefined
    )
  // Why a local pick on any failure: an older Orca cannot reserve, and a name never blocks a launch.
  return reserved?.name === null || typeof reserved?.name === 'string'
    ? reserved.name
    : nextMemberName(roster, taken, locale)
}
