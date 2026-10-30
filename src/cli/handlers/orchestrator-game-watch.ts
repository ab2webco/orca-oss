import type { CommandHandler } from '../dispatch'

type GameFleetWait = { version: number; changed: boolean }

const WAIT_MS = 25_000
// Why the grace: the socket must outlast the host's own wait, or a quiet fleet reads as a dead Orca.
const SOCKET_GRACE_MS = 10_000

export const ORCHESTRATOR_GAME_WATCH_HANDLERS: Record<string, CommandHandler> = {
  // Why it never returns: the orca-game mod streams it for the session and restarts it when it dies.
  'game watch': async ({ client }) => {
    let since = (await client.call<GameFleetWait>('game.fleetWait', {})).result.version
    console.log(`ready ${since}`)
    for (;;) {
      const { result } = await client.call<GameFleetWait>(
        'game.fleetWait',
        { since, timeoutMs: WAIT_MS },
        { timeoutMs: WAIT_MS + SOCKET_GRACE_MS }
      )
      if (result.changed) {
        console.log(`fleet ${result.version}`)
      }
      since = result.version
    }
  }
}
