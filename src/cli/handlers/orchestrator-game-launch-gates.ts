import { RuntimeClientError } from '../runtime-client'
import { gameHostBusyRefusalOf } from '../../shared/orchestrator-game-host-capacity'
import {
  gameHostLoadFor,
  LOCAL_GAME_HOST,
  type GameHostLoad
} from '../../shared/orchestrator-game-host-load'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'

/** Throws `refusal` unless `--<flag> "<why>"` overrides it, then prints why the launch went past. */
export function refuseUnlessPast(
  flags: ReadonlyMap<string, string | boolean>,
  refusal: string | null,
  past: { flag: string; label: string }
): void {
  if (!refusal) {
    return
  }
  const why = flags.get(past.flag)
  if (typeof why !== 'string' || why.trim() === '') {
    throw new RuntimeClientError('cap_reached', refusal)
  }
  console.error(`${past.label}: ${why.trim()}`)
}

/** The busy refusal for the machine a launch lands on: `--on`'s, by name or id, else this one. */
export function launchBusyRefusalOf(
  state: Pick<OrchestratorGameState, 'hostCapacity' | 'localHost'>,
  hosts: readonly GameHostLoad[] | undefined,
  on: string | null,
  ticket: string
): string | null {
  const host = gameHostLoadFor(hosts ?? [], on)?.host ?? on ?? LOCAL_GAME_HOST
  const capacity = state.hostCapacity ?? (state.localHost ? [state.localHost] : [])
  return gameHostBusyRefusalOf(capacity, host, ticket)
}
