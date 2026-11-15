import type { CommandHandler } from '../dispatch'
import type { RuntimeClient } from '../runtime-client'
import {
  emptyGameLeadAlertMemory,
  gameLeadAlertsOf,
  newGameLeadAlertsOf
} from '../../shared/orchestrator-game-lead-alerts'
import { readCallerGameState } from './orchestrator-game-board-call'

type GameFleetWait = { version: number; changed: boolean }

const WAIT_MS = 25_000
// Why the grace: the socket must outlast the host's own wait, or a quiet fleet reads as a dead Orca.
const SOCKET_GRACE_MS = 10_000
// Why a minute: queue and PR state come from the host's 90 s cache; reading faster spends nothing but sees nothing new.
const LEAD_READ_MS = 60_000

type FleetTick = (changed: boolean) => Promise<void>

// Why it never returns: the orca-game mod streams it for the session and restarts it when it dies.
async function watchFleet(client: RuntimeClient, onTick: FleetTick | null): Promise<never> {
  let since = (await client.call<GameFleetWait>('game.fleetWait', {})).result.version
  console.log(`ready ${since}`)
  await onTick?.(true)
  for (;;) {
    const { result } = await client.call<GameFleetWait>(
      'game.fleetWait',
      { since, timeoutMs: WAIT_MS },
      { timeoutMs: WAIT_MS + SOCKET_GRACE_MS }
    )
    // Why: the lead's watch wakes its agent per line, so it prints alerts only.
    if (result.changed && onTick === null) {
      console.log(`fleet ${result.version}`)
    }
    since = result.version
    await onTick?.(result.changed)
  }
}

/** The lead's watch: one line per new condition to act on, from the same cached state the band reads. */
function leadTick(client: RuntimeClient): FleetTick {
  const memory = emptyGameLeadAlertMemory()
  const printed = new Set<string>()
  let readAt = Number.NEGATIVE_INFINITY
  return async (changed) => {
    const now = Date.now()
    if (!changed && now - readAt < LEAD_READ_MS) {
      return
    }
    readAt = now
    // Why settle: a missed read only delays an alert; the next tick reads again.
    const state = await readCallerGameState(client).catch(() => null)
    if (state === null) {
      return
    }
    for (const alert of newGameLeadAlertsOf(gameLeadAlertsOf(state.result, memory, now), printed)) {
      console.log(`alert ${alert.line}`)
    }
  }
}

export const ORCHESTRATOR_GAME_WATCH_HANDLERS: Record<string, CommandHandler> = {
  'game watch': async ({ client, flags }) => {
    await watchFleet(client, flags.get('lead') === true ? leadTick(client) : null)
  }
}
