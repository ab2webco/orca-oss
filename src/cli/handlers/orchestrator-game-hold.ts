import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { callGameBoard, gameBoardCaller } from './orchestrator-game-board-call'
import type { GameStopResult } from './orchestrator-game-stop'
import {
  UNREADABLE_GAME_STOP,
  gameStopRefusal,
  type GameStop
} from '../../shared/orchestrator-game-stop-state'
import type { OrchestratorGameState } from '../../shared/orchestrator-game-state'

type Client = Parameters<CommandHandler>[0]['client']

export type GameHold = { set: boolean; stopped?: GameStop; reason?: string }

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const STOP_MESSAGE =
  'STOP: the person stopped the whole team. Stop now: no tool calls, no commits, no pushes. Wait until your lead tells you to resume.'

/** Refuses a launch, wave, push or move while the project is on STOP; the state read decides. */
export function refuseWhileStopped(state: Pick<OrchestratorGameState, 'stopped'>, what: string) {
  if (state.stopped) {
    throw new RuntimeClientError('game_stopped', gameStopRefusal(state.stopped, what))
  }
}

/** A fresh read between launches; an Orca without STOP has none, any other failure counts as set. */
export async function readStopNow(client: Client): Promise<GameStop | null> {
  try {
    const { result } = await client.call<{ stopped: GameStop | null }>(
      'game.stopSwitch',
      gameBoardCaller()
    )
    return result.stopped
  } catch (error) {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      return null
    }
    return UNREADABLE_GAME_STOP
  }
}

/** Sets STOP before any member is stopped; a failure is reported, never a reason to keep members running. */
export async function holdGameStop(client: Client): Promise<GameHold> {
  try {
    const { result } = await callGameBoard<{ stopped: GameStop }>(
      client,
      'game.stopSwitch',
      { ...gameBoardCaller(), set: true },
      'STOP'
    )
    return { set: true, stopped: result.stopped }
  } catch (error) {
    process.exitCode = 1
    return { set: false, reason: errorText(error) }
  }
}

/** Members a stop could not end get the STOP in their orchestration inbox. */
export async function tellStillRunning(
  client: Client,
  stop: GameStopResult,
  handleOf: (ticket: string | null, name: string) => string | null
): Promise<string[]> {
  const told: string[] = []
  for (const member of stop.members.filter((one) => one.outcome === 'failed')) {
    const handle = handleOf(member.ticket, member.name)
    if (!handle) {
      continue
    }
    const sent = await client
      .call('orchestration.send', {
        from: process.env.ORCA_TERMINAL_HANDLE,
        to: handle,
        subject: 'STOP',
        body: STOP_MESSAGE,
        type: 'status',
        priority: 'urgent'
      })
      .then(() => true)
      .catch(() => false)
    if (sent) {
      told.push(member.ticket ?? member.name)
    }
  }
  return told
}

export const ORCHESTRATOR_GAME_HOLD_HANDLERS: Record<string, CommandHandler> = {
  'game resume': async ({ client, json }) => {
    const response = await callGameBoard<{ stopped: null; changed: boolean }>(
      client,
      'game.stopSwitch',
      { ...gameBoardCaller(), set: false },
      'STOP'
    ).catch((error: unknown) => {
      if (error instanceof RuntimeClientError && error.code === 'incompatible_runtime') {
        throw error
      }
      throw new RuntimeClientError('game_stopped', `STOP is still set: ${errorText(error)}`)
    })
    printResult(response, json, (result) =>
      result.changed
        ? 'STOP cleared: launches, waves and pushes run again. Nothing was relaunched.'
        : 'The project was not on STOP.'
    )
  }
}
