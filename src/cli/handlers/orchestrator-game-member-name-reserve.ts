import type { CommandHandler } from '../dispatch'
import { gameBoardCaller } from './orchestrator-game-board-call'
import { isLaunchRefusal } from './orchestrator-game-launch-retry'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'
import {
  leadCharacterOf,
  memberNameOf,
  memberRosterOf,
  nextMemberName
} from '../../shared/orchestrator-game-member-names'

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

/** The names this lead's members hold, and the lead's own default; a remote start that failed has none. */
export const namesInUseOf = (state: OrchestratorGameState): string[] => {
  // Why: a lead with no Lead name is shown as this character, so no member may take it (ORCA-1094).
  const lead = state.lead?.label ? null : leadCharacterOf(memberRosterOf(state), 'en')
  return [
    ...state.agents.flatMap((agent) =>
      agent.remote?.startFailed ? [] : (memberNameOf(agent.displayName) ?? [])
    ),
    ...(lead === null ? [] : [lead])
  ]
}

// Why: workerStart names only a worktree it creates, and a member's own band reads that name.
export async function nameReusedWorktree(
  client: Client,
  worktree: string,
  title: string
): Promise<void> {
  await client.call('worktree.set', { worktree, displayName: title }).catch(() => undefined)
}

/** How far a launch got, which decides whether its name can go back. */
export type GameLaunchStart = { asked: boolean; hasPane?: boolean }

/** Runs a launch; one that failed gives its name back now, not when its hold runs out. */
export async function givingNameBackOnFailure<T extends { state: string }>(
  client: Client,
  ticket: string,
  launch: (start: GameLaunchStart) => Promise<T>
): Promise<T> {
  // Why an older Orca is fine: it has no such call, and its hold runs out by itself.
  const release = () =>
    client.call('game.memberNameRelease', { ...gameBoardCaller(), ticket }).catch(() => undefined)
  const start: GameLaunchStart = { asked: false }
  try {
    const launched = await launch(start)
    if (launched.state === 'failed' && !start.hasPane) {
      await release()
    }
    return launched
  } catch (error) {
    // Why not any error: a start the host may have run keeps its name until the hold runs out.
    if (!start.asked || isLaunchRefusal(error)) {
      await release()
    }
    throw error
  }
}
