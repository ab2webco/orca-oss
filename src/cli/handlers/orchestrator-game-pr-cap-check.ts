import type { CommandHandler } from '../dispatch'
import {
  gamePrCapVerdictOf,
  prCapUncheckedLineOf,
  PR_CAP_REFUSE_EXIT,
  type GamePrCap
} from '../../shared/orchestrator-game-pr-cap'
import { gameCallerRole } from './orchestrator-game-board-call'

/** Exit code for "not checked": the gh wrapper then runs gh and prints the line. */
export const PR_CAP_UNCHECKED_EXIT = 4

export const ORCHESTRATOR_GAME_PR_CAP_HANDLERS: Record<string, CommandHandler> = {
  'game pr-cap-check': async ({ client }) => {
    // Why catch all: an older host has no game.prCapCheck, and a failed check must never block gh.
    const cap = await client
      .call<GamePrCap>('game.prCapCheck', {
        terminalHandle: process.env.ORCA_TERMINAL_HANDLE,
        paneKey: process.env.ORCA_PANE_KEY,
        ...gameCallerRole()
      })
      .then((response) => response.result)
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
    const verdict =
      typeof cap === 'string'
        ? { kind: 'unchecked' as const, line: prCapUncheckedLineOf(cap) }
        : gamePrCapVerdictOf(cap)
    if (verdict.kind === 'pass') {
      return
    }
    process.stderr.write(`${verdict.line}\n`)
    process.exitCode = verdict.kind === 'refuse' ? PR_CAP_REFUSE_EXIT : PR_CAP_UNCHECKED_EXIT
  }
}
