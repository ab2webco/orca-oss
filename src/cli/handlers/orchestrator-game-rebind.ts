import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { isDevCliInvocation, resolveCoordinatorTerminalHandle } from './orchestration'
import { readCallerGameState } from './orchestrator-game-launch'
import { refuseWhileStopped } from './orchestrator-game-hold'
import { dispatchOf, STOPPABLE, type GameStopWorker } from './orchestrator-game-stop'
import { hostClientOf } from './orchestrator-game-host-client'
import { rebindTerminalOf } from './orchestrator-game-rebind-terminal'
import { remoteDispatchIdOf } from '../../shared/orchestrator-game-auto-release'
import { ticketOfMember } from '../../shared/orchestrator-game-fleet-verbs'
import type { GameAgent, OrchestratorGameState } from '../../shared/orchestrator-game-state'
import type { RuntimeTerminalSummary, RuntimeWorktreePsResult } from '../../shared/runtime-types'

type Client = Parameters<CommandHandler>[0]['client']

type Stale = {
  dispatchId: string
  taskId: string
  runId: string
  workerState: string
  terminalHandle: string | null
  worktreeId: string
  /** The paired host it runs on; null when local. */
  environmentId: string | null
}

export type GameRebindResult = {
  ticket: string
  rebound: boolean
  from?: string | null
  to?: string
  dispatchId?: string
  state?: string
  refusal?: string
  handles?: string[]
}

const TICKET = /^[A-Z0-9][A-Z0-9_-]{0,39}$/
// Why past the default 200: the member's worktree may sort after the most recent ones.
const PS_LIMIT = 10_000
// The states a retry may start from.
const SETTLED = new Set(['failed', 'stopped', 'abandoned'])

function memberOf(state: OrchestratorGameState, ticket: string): GameAgent {
  const member = state.agents.find(
    (agent) => agent.isMember && !agent.isLeader && ticketOfMember(agent) === ticket
  )
  if (!member) {
    throw new RuntimeClientError(
      'invalid_argument',
      `No member holds ${ticket}; see \`orca game fleet\`.`
    )
  }
  return member
}

/** The member's dispatch the replaced terminal left behind, and where it ran. */
async function staleOf(client: Client, member: GameAgent): Promise<Stale | null> {
  const { result } = await client.call<{ workers: GameStopWorker[] }>(
    'orchestration.workerList',
    {}
  )
  const remoteId = remoteDispatchIdOf(member)
  if (remoteId) {
    const worker = result.workers.find((one) => one.dispatchId === remoteId)
    const shown = await client.call<{
      dispatch: { task_id: string; run_id: string }
      worker: { worktree_id: string | null }
      server?: { environmentId: string }
    }>('orchestration.workerShow', { dispatch: remoteId })
    // Why the worker's worktree: the home keeps the host's worktree id there once the member started.
    const { dispatch, server } = shown.result
    const remoteWorktreeId = shown.result.worker.worktree_id
    return server && remoteWorktreeId
      ? {
          dispatchId: remoteId,
          taskId: dispatch.task_id,
          runId: dispatch.run_id,
          workerState: worker?.workerState ?? '',
          terminalHandle: member.terminalHandle ?? null,
          worktreeId: remoteWorktreeId,
          environmentId: server.environmentId
        }
      : null
  }
  const worktreeId = member.worktree?.id ?? null
  // Why the worktree: the member's row may already show the new terminal, never the stale one.
  const worker = dispatchOf({ row: { terminalHandle: null }, worktreeId }, result.workers)
  return worker?.taskId && worker.runId && worktreeId
    ? {
        dispatchId: worker.dispatchId,
        taskId: worker.taskId,
        runId: worker.runId,
        workerState: worker.workerState,
        terminalHandle: worker.agentTerminalHandle,
        worktreeId,
        environmentId: null
      }
    : null
}

/** Starts the member's task again on the terminal it runs in now, which mail then reaches. */
async function rebindMember(
  client: Client,
  member: GameAgent,
  ticket: string,
  flags: Map<string, string | boolean>,
  cwd: string
): Promise<GameRebindResult> {
  const stale = await staleOf(client, member)
  if (!stale) {
    return { ticket, rebound: false, refusal: 'it has no dispatch to rebind' }
  }
  const where = stale.environmentId ? hostClientOf(stale.environmentId) : client
  const [terminals, workers, ps] = await Promise.all([
    where.call<{ terminals: RuntimeTerminalSummary[] }>('terminal.list', {
      worktree: `id:${stale.worktreeId}`
    }),
    where.call<{ workers: GameStopWorker[] }>('orchestration.workerList', {}),
    // Why: only its agent rows tell an agent terminal from a plain shell, and whether it is mid-turn.
    where.call<RuntimeWorktreePsResult>('worktree.ps', { limit: PS_LIMIT })
  ])
  const choice = rebindTerminalOf(stale, {
    terminals: terminals.result.terminals,
    workers: workers.result.workers,
    agents:
      ps.result.worktrees.find((worktree) => worktree.worktreeId === stale.worktreeId)?.agents ?? []
  })
  if (!('handle' in choice)) {
    return { ticket, rebound: false, from: stale.terminalHandle, ...choice }
  }
  let settled = stale.workerState
  if (STOPPABLE.has(settled) && settled !== 'stop_unknown') {
    const stopped = await client.call<{ state: string }>('orchestration.workerStop', {
      dispatch: stale.dispatchId
    })
    settled = stopped.result.state
  }
  // Why: with its terminal gone no stop is proven, and abandoning closes nothing.
  if (!SETTLED.has(settled)) {
    await client.call('orchestration.workerAbandon', { dispatch: stale.dispatchId })
  }
  const started = await client.call<{ dispatchId: string; state: string }>(
    'orchestration.workerStart',
    {
      task: stale.taskId,
      retryOf: stale.dispatchId,
      run: stale.runId,
      worktree: `id:${stale.worktreeId}`,
      terminal: choice.handle,
      ...(stale.environmentId ? { on: stale.environmentId } : {}),
      from: await resolveCoordinatorTerminalHandle(flags, cwd, client),
      devMode: isDevCliInvocation()
    }
  )
  return {
    ticket,
    rebound: started.result.state === 'ready',
    from: stale.terminalHandle,
    to: choice.handle,
    dispatchId: started.result.dispatchId,
    state: started.result.state
  }
}

export const formatGameRebind = (result: GameRebindResult): string =>
  result.to
    ? `${result.ticket} rebound ${result.from ?? '?'} → ${result.to}: member ${result.dispatchId} [${result.state}]`
    : `${result.ticket} not rebound: ${result.refusal}${result.handles?.length ? ` (${result.handles.join(', ')})` : ''}`

export const ORCHESTRATOR_GAME_REBIND_HANDLERS: Record<string, CommandHandler> = {
  'game rebind': async ({ flags, client, cwd, json }) => {
    const raw = flags.get('ticket')
    const ticket = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
    if (!TICKET.test(ticket)) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Name the member to rebind by its ticket, like CIN-12.'
      )
    }
    const response = await readCallerGameState(client)
    refuseWhileStopped(response.result, `rebinding ${ticket}`)
    const result = await rebindMember(client, memberOf(response.result, ticket), ticket, flags, cwd)
    if (!result.rebound) {
      process.exitCode = 1
    }
    printResult({ ...response, result }, json, formatGameRebind)
  }
}
