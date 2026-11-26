import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { callGameBoard, gameBoardCaller, readCallerGameState } from './orchestrator-game-board-call'
import { stopOne, type GameStopEntry, type GameStopWorker } from './orchestrator-game-stop'
import { remoteDispatchIdOf } from '../../shared/orchestrator-game-auto-release'
import { gameFleetMembersOf, gameFleetRowOf } from '../../shared/orchestrator-game-fleet-verbs'
import { foundHostPaneOf } from '../../shared/orchestrator-game-found-host-pane'
import {
  gameRemoveKeyOf,
  gameRemoveMatchesOf,
  gameRemoveStillRuns
} from '../../shared/orchestrator-game-remove-target'

export type GameRemoveResult = {
  name: string
  removed: boolean
  host?: string
  /** What ending its session did; absent when its host did not answer, so nothing was tried. */
  stop?: GameStopEntry
  /** Its host did not answer: Orca forgot it here and cannot tell whether it still runs there. */
  unproven?: true
  refusal?: string
  /** Every member the key named, when it named more than one. */
  matches?: { name: string; key: string; host: string | null }[]
}

const stopText = (result: GameRemoveResult): string => {
  const stop = result.stop
  if (result.unproven) {
    return `; ${result.host ?? 'its host'} did not answer, so Orca only forgot it here, and if its agent still runs there it keeps running`
  }
  if (!stop || stop.outcome === 'already stopped') {
    return '; no session of it was running'
  }
  const done = [
    stop.dispatchId ? `dispatch ${stop.dispatchId} ${stop.dispatchState ?? '?'}` : '',
    stop.closedTerminal ? `closed ${stop.closedTerminal}` : ''
  ].filter(Boolean)
  return stop.outcome === 'stopped'
    ? `; its session ended${done.length > 0 ? ` (${done.join(', ')})` : ''}`
    : `; ending it failed (${stop.reason ?? 'no reason given'}), and nothing shows it still runs`
}

export const formatGameRemove = (result: GameRemoveResult): string =>
  result.matches
    ? [
        `${result.name} names ${result.matches.length} members; remove one by its key:`,
        ...result.matches.map(
          (one) =>
            `  orca game remove ${one.key}   # ${one.name}${one.host ? ` on ${one.host}` : ''}`
        )
      ].join('\n')
    : result.refusal
      ? `${result.name} not removed: ${result.refusal}`
      : `${result.name} removed from the fleet${result.host ? ` (on ${result.host})` : ''}${stopText(result)}. No other member was touched.`

export const ORCHESTRATOR_GAME_REMOVE_HANDLERS: Record<string, CommandHandler> = {
  'game remove': async ({ flags, client, json }) => {
    const raw = flags.get('member')
    const key = typeof raw === 'string' ? raw.trim() : ''
    if (!key) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Name the member to remove by its dispatch id or exact name, like ctx_1a2b3c4d5e6f.'
      )
    }
    const response = await readCallerGameState(client)
    const state = response.result
    if (state.role !== 'lead') {
      throw new RuntimeClientError('invalid_argument', 'Only the lead removes members.')
    }
    const print = (result: GameRemoveResult): void => {
      if (!result.removed) {
        process.exitCode = 1
      }
      printResult({ ...response, result }, json, formatGameRemove)
    }
    const { result: listed } = await client.call<{ workers: GameStopWorker[] }>(
      'orchestration.workerList',
      {}
    )
    const matches = gameRemoveMatchesOf(gameFleetMembersOf(state), key, listed.workers)
    if (matches.length === 0) {
      throw new RuntimeClientError(
        'invalid_argument',
        `No member of this lead's fleet has the dispatch id or name ${key}; see \`orca game fleet\`.`
      )
    }
    if (matches.length > 1) {
      return print({
        name: key,
        removed: false,
        matches: matches.map((agent) => ({
          name: agent.displayName ?? agent.paneKey,
          key: gameRemoveKeyOf(agent.paneKey),
          host: agent.remote?.host ?? null
        }))
      })
    }
    const agent = matches[0]
    const row = gameFleetRowOf(agent)
    const host = agent.remote?.host
    const base = { name: row.name, ...(host ? { host } : {}) }
    // Why: a host that does not answer cannot stop it, and a stop sent there waits on its retry.
    const silent = agent.remote !== undefined && !agent.remote.stateKnown
    // Why no worktree: the dispatch must be this member's own terminal's, never a sibling's there.
    const stop = silent
      ? undefined
      : await stopOne(
          client,
          {
            row,
            worktreeId: null,
            remoteDispatchId: remoteDispatchIdOf(agent),
            hostPane: foundHostPaneOf(agent)
          },
          listed.workers
        )
    if (stop?.outcome === 'failed' && gameRemoveStillRuns(agent)) {
      return print({
        ...base,
        removed: false,
        stop,
        refusal: `its session still runs and did not stop: ${stop.reason ?? 'no reason given'}`
      })
    }
    await callGameBoard(
      client,
      'game.fleetForget',
      { ...gameBoardCaller(), agent: { paneKey: agent.paneKey, name: row.name } },
      'member removals'
    )
    print({
      ...base,
      removed: true,
      ...(stop ? { stop } : {}),
      ...(silent ? { unproven: true } : {})
    })
  }
}
