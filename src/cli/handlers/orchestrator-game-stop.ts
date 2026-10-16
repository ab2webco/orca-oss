import type { CommandHandler } from '../dispatch'
import { gameStopTargetsOf, type GameStopTarget } from '../../shared/orchestrator-game-fleet-verbs'

type Client = Parameters<CommandHandler>[0]['client']

export type GameStopWorker = {
  dispatchId: string
  agentTerminalHandle: string | null
  workerState: string
  terminalState: string | null
  resource?: { worktreeId: string | null } | null
}

export type GameStopEntry = {
  ticket: string | null
  name: string
  outcome: 'stopped' | 'already stopped' | 'failed'
  dispatchId?: string
  dispatchState?: string
  closedTerminal?: string
  reason?: string
}

export type GameStopResult = { members: GameStopEntry[] }

// Why: a stop on any other state is a no-op receipt; those dispatches only keep a terminal, if anything.
const STOPPABLE: ReadonlySet<string> = new Set([
  'starting',
  'ready',
  'start_unknown',
  'stopping',
  'stop_unknown'
])

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function dispatchOf(target: GameStopTarget, workers: GameStopWorker[]): GameStopWorker | undefined {
  const handle = target.row.terminalHandle
  const live = workers.filter((worker) => STOPPABLE.has(worker.workerState))
  return (
    live.findLast((worker) => handle !== null && worker.agentTerminalHandle === handle) ??
    live.findLast(
      (worker) => target.worktreeId !== null && worker.resource?.worktreeId === target.worktreeId
    )
  )
}

async function stopOne(
  client: Client,
  target: GameStopTarget,
  workers: GameStopWorker[]
): Promise<GameStopEntry> {
  const entry: GameStopEntry = {
    ticket: target.row.ticket,
    name: target.row.name,
    outcome: 'already stopped'
  }
  const dispatch = dispatchOf(target, workers)
  let closedByStop: string | null = null
  if (dispatch) {
    entry.dispatchId = dispatch.dispatchId
    try {
      const { result } = await client.call<{ state: string; processAction: string }>(
        'orchestration.workerStop',
        { dispatch: dispatch.dispatchId }
      )
      entry.dispatchState = result.state
      entry.outcome = 'stopped'
      if (result.processAction === 'closed_agent_terminal') {
        closedByStop = dispatch.agentTerminalHandle
      }
    } catch (error) {
      entry.reason = `dispatch stop failed: ${errorText(error)}`
    }
  }
  const handle = target.row.terminalHandle
  // Why: a stopped dispatch can leave its terminal retained, so the agent would keep running.
  if (handle && handle !== closedByStop) {
    try {
      await client.call('terminal.close', { terminal: handle })
      entry.closedTerminal = handle
      entry.outcome = 'stopped'
    } catch (error) {
      entry.outcome = 'failed'
      entry.reason = `closing ${handle} failed: ${errorText(error)}`
    }
  } else if (dispatch && entry.dispatchState === undefined) {
    entry.outcome = 'failed'
  }
  return entry
}

/** Ends every target member's agent: its dispatch first, then its terminal if one is left. */
export async function stopGameMembers(
  client: Client,
  state: Parameters<typeof gameStopTargetsOf>[0],
  tickets: 'all' | readonly string[]
): Promise<GameStopResult> {
  const { targets, missing } = gameStopTargetsOf(state, tickets)
  const members: GameStopEntry[] = []
  if (targets.length > 0) {
    const { result } = await client.call<{ workers: GameStopWorker[] }>(
      'orchestration.workerList',
      {}
    )
    for (const target of targets) {
      members.push(await stopOne(client, target, result.workers))
    }
  }
  for (const ticket of missing) {
    members.push({
      ticket,
      name: ticket,
      outcome: 'failed',
      reason: `no member holds ${ticket}`
    })
  }
  if (members.some((member) => member.outcome === 'failed')) {
    process.exitCode = 1
  }
  return { members }
}

export function formatStop(stop: GameStopResult): string {
  if (stop.members.length === 0) {
    return 'No members to stop.'
  }
  return stop.members
    .map((member) => {
      const done = [
        member.dispatchId ? `dispatch ${member.dispatchId} ${member.dispatchState ?? '?'}` : '',
        member.closedTerminal ? `closed ${member.closedTerminal}` : ''
      ].filter(Boolean)
      return `${member.ticket ?? member.name} ${member.outcome}${done.length > 0 ? ` (${done.join(', ')})` : ''}${member.reason ? `: ${member.reason}` : ''}`
    })
    .join('\n')
}
