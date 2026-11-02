import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { readCallerGameState, setGameAgentDropped } from './orchestrator-game-board-call'
import { isOurGameAgentNamed } from './orchestrator-game-adopt'
import { STOPPABLE, dispatchOf, type GameStopWorker } from './orchestrator-game-stop'
import { remoteDispatchIdOf } from '../../shared/orchestrator-game-auto-release'
import type { GameAgent } from '../../shared/orchestrator-game-state'

type Client = Parameters<CommandHandler>[0]['client']

export type GameDropResult = {
  name: string
  dropped: boolean
  already?: true
  host?: string
  dispatchId?: string
  /** The live dispatch it ended; the agent and its pane keep running (ORCA-943). */
  detached?: string
  refusal?: string
}

/** The member's dispatch that still reports to the lead, if any; a found agent has none. */
async function liveDispatchOf(client: Client, agent: GameAgent): Promise<string | null> {
  if (agent.found) {
    return null
  }
  const { result } = await client.call<{ workers: GameStopWorker[] }>(
    'orchestration.workerList',
    {}
  )
  const remoteId = remoteDispatchIdOf(agent)
  const live = remoteId
    ? result.workers.find(
        (worker) => worker.dispatchId === remoteId && STOPPABLE.has(worker.workerState)
      )
    : dispatchOf(
        {
          row: { terminalHandle: agent.terminalHandle ?? null },
          worktreeId: agent.worktree?.id ?? null
        },
        result.workers
      )
  return live?.dispatchId ?? null
}

export const formatGameDrop = (result: GameDropResult): string =>
  result.refusal
    ? `${result.name} not dropped: ${result.refusal}`
    : result.already
      ? `${result.name} is already out of the fleet; orca game adopt ${result.name} brings it back`
      : `${result.name} dropped from the fleet${result.host ? ` (on ${result.host})` : ''}${result.detached ? `, its dispatch ${result.detached} ended` : ''}; its agent and worktree are untouched, and orca game adopt ${result.name} brings it back`

export const ORCHESTRATOR_GAME_DROP_HANDLERS: Record<string, CommandHandler> = {
  'game drop': async ({ flags, client, json }) => {
    const raw = flags.get('name')
    const name = typeof raw === 'string' ? raw.trim() : ''
    if (!name) {
      throw new RuntimeClientError('invalid_argument', 'Name the agent to drop, like ORCA-915.')
    }
    const response = await readCallerGameState(client)
    const state = response.result
    if (state.role !== 'lead') {
      throw new RuntimeClientError('invalid_argument', 'Only the lead drops agents from its fleet.')
    }
    const leadWorktreeId = state.worktree?.id ?? null
    // Why the host or the repo: a found row on this machine may be any project's (ORCA-948).
    const ours = (agent: GameAgent): boolean => isOurGameAgentNamed(agent, name, leadWorktreeId)
    const print = (result: GameDropResult): void => {
      if (!result.dropped) {
        process.exitCode = 1
      }
      printResult({ ...response, result }, json, formatGameDrop)
    }
    if (state.droppedAgents?.some(ours)) {
      return print({ name, dropped: true, already: true })
    }
    const agent = state.agents.find(ours)
    if (!agent) {
      throw new RuntimeClientError(
        'invalid_argument',
        `No agent named ${name} is in this lead's fleet; see \`orca game fleet\`.`
      )
    }
    const host = agent.remote?.host
    const live = await liveDispatchOf(client, agent)
    // Why: a paired host's stop closes the pane there; detaching there needs a host method first.
    if (live && host) {
      return print({
        name,
        dropped: false,
        host,
        dispatchId: live,
        refusal: `its dispatch ${live} on ${host} is live, and a member on a paired host cannot be detached yet; drop it after its worker_done, or \`orca game stop\` ends it`
      })
    }
    if (live) {
      await client.call('orchestration.workerDetach', { dispatch: live })
    }
    await setGameAgentDropped(client, agent, name, true)
    print({ name, dropped: true, ...(host ? { host } : {}), ...(live ? { detached: live } : {}) })
  }
}
