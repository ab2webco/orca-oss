import type { CommandHandler } from '../dispatch'
import type { GameSweepEntry } from '../../shared/orchestrator-game-fleet-verbs'
import type { GameAgent } from '../../shared/orchestrator-game-state'
import type { SweepClose } from './orchestrator-game-fleet-format'

type Client = Parameters<CommandHandler>[0]['client']

export type SweepWorkerRow = {
  dispatchId: string
  agentTerminalHandle: string | null
  terminalState: string | null
  workerState: string
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Why: a terminal reused across dispatches keeps its released rows; only a live one owns it now.
const liveDispatchOf = (
  handle: string | null,
  workers: SweepWorkerRow[]
): SweepWorkerRow | undefined =>
  handle === null
    ? undefined
    : workers.findLast(
        (worker) => worker.agentTerminalHandle === handle && worker.terminalState !== 'released'
      )

// Why: follow-ups share a remote terminal, so its handle names several dispatches; the row names one (ORCA-1076).
export function sweptDispatchOf(
  entry: GameSweepEntry,
  member: GameAgent | undefined,
  workers: SweepWorkerRow[]
): Pick<SweepWorkerRow, 'dispatchId' | 'workerState'> | undefined {
  if (!member?.remote) {
    return liveDispatchOf(entry.row.terminalHandle, workers)
  }
  const dispatchId = member.paneKey.replace(/^remote:/, '')
  return (
    workers.find((worker) => worker.dispatchId === dispatchId) ?? { dispatchId, workerState: '' }
  )
}

export async function closeFinished(
  client: Client,
  entry: GameSweepEntry,
  dispatch: Pick<SweepWorkerRow, 'dispatchId'> | undefined
): Promise<SweepClose | null> {
  const handle = entry.row.terminalHandle
  if (!handle) {
    return null
  }
  try {
    if (dispatch) {
      const { result } = await client.call<{
        dispatchId: string
        state: string
        reason?: string
        recovery?: string
        worktreeDispatches?: { dispatchId: string; state: string }[]
      }>('orchestration.workerRelease', { dispatch: dispatch.dispatchId })
      // Why: an unproven release must never be followed by a guessed terminal close.
      if (result.state === 'release_unknown') {
        process.exitCode = 1
      }
      return {
        via: 'release',
        dispatchId: result.dispatchId,
        state: result.state,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.recovery ? { recovery: result.recovery } : {}),
        ...(result.worktreeDispatches?.length
          ? {
              worktreeDispatches: result.worktreeDispatches.map(({ dispatchId, state }) => ({
                dispatchId,
                state
              }))
            }
          : {})
      }
    }
    await client.call('terminal.close', { terminal: handle })
    return { via: 'close', terminal: handle }
  } catch (error) {
    process.exitCode = 1
    return { via: dispatch ? 'release' : 'close', error: errorText(error) }
  }
}
