import type { CommandHandler } from '../dispatch'
import { RuntimeClientError } from '../runtime-client'
import { gameStopTargetsOf, type GameStopTarget } from '../../shared/orchestrator-game-fleet-verbs'
import { memberRosterOf } from '../../shared/orchestrator-game-member-names'
import { agentOfRow, recordFreedMember } from './orchestrator-game-history-record'

type Client = Parameters<CommandHandler>[0]['client']

export type GameStopWorker = {
  dispatchId: string
  taskId?: string
  runId?: string
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
  /** Its tab was gone before the close; nothing was left to close. */
  alreadyClosedTerminal?: string
  reason?: string
  /** Why its history record was not written; it is stopped anyway. */
  history?: string
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

// Why: the runtime has no wire code for this; it arrives as runtime_error carrying the bare message.
const isTabGone = (error: unknown): boolean =>
  error instanceof RuntimeClientError && error.message === 'tab_not_found'

/** The member's live dispatch: the one on its terminal, else the one in its worktree. */
export function dispatchOf(
  target: { row: Pick<GameStopTarget['row'], 'terminalHandle'>; worktreeId: string | null },
  workers: GameStopWorker[]
): GameStopWorker | undefined {
  const handle = target.row.terminalHandle
  const live = workers.filter((worker) => STOPPABLE.has(worker.workerState))
  return (
    live.findLast((worker) => handle !== null && worker.agentTerminalHandle === handle) ??
    live.findLast(
      (worker) => target.worktreeId !== null && worker.resource?.worktreeId === target.worktreeId
    )
  )
}

/** Ends one member's agent: its live dispatch first, then its terminal if one is left. */
export async function stopOne(
  client: Client,
  target: {
    row: Pick<GameStopTarget['row'], 'ticket' | 'name' | 'terminalHandle'> &
      Partial<Pick<GameStopTarget['row'], 'host'>>
    worktreeId: string | null
    remoteDispatchId?: string | null
  },
  workers: GameStopWorker[]
): Promise<GameStopEntry> {
  const entry: GameStopEntry = {
    ticket: target.row.ticket,
    name: target.row.name,
    outcome: 'already stopped'
  }
  if (target.remoteDispatchId) {
    const remote = { row: target.row, remoteDispatchId: target.remoteDispatchId }
    return await stopRemote(client, entry, remote, workers)
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
      if (isTabGone(error)) {
        entry.alreadyClosedTerminal = handle
        entry.outcome = 'stopped'
      } else {
        entry.outcome = 'failed'
        entry.reason = `closing ${handle} failed: ${errorText(error)}`
      }
    }
  } else if (dispatch && entry.dispatchState === undefined) {
    entry.outcome = 'failed'
  }
  return entry
}

/** A remote member ends on its host: stop it if live, then release its terminal and worktree there. */
async function stopRemote(
  client: Client,
  entry: GameStopEntry,
  target: { row: Partial<Pick<GameStopTarget['row'], 'host'>>; remoteDispatchId: string },
  workers: GameStopWorker[]
): Promise<GameStopEntry> {
  const dispatchId = target.remoteDispatchId
  entry.dispatchId = dispatchId
  const worker = workers.find((candidate) => candidate.dispatchId === dispatchId)
  try {
    if (worker && STOPPABLE.has(worker.workerState)) {
      await client.call('orchestration.workerStop', { dispatch: dispatchId })
    }
    const { result } = await client.call<{ state: string; reason?: string; recovery?: string }>(
      'orchestration.workerRelease',
      { dispatch: dispatchId }
    )
    entry.dispatchState = result.state
    if (result.state === 'released' || result.state === 'already_released') {
      entry.outcome = 'stopped'
    } else {
      entry.outcome = 'failed'
      entry.reason = `${target.row.host ?? 'its host'} kept it (${result.reason ?? result.state})${result.recovery ? `: ${result.recovery}` : ''}`
    }
  } catch (error) {
    entry.outcome = 'failed'
    entry.reason = `remote release failed: ${errorText(error)}`
  }
  return entry
}

/** Ends every target member's agent: its dispatch first, then its terminal if one is left. */
export async function stopGameMembers(
  client: Client,
  state: Parameters<typeof gameStopTargetsOf>[0] & Parameters<typeof memberRosterOf>[0],
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
      const member = agentOfRow(state, target.row)
      const history = member
        ? await recordFreedMember({
            client,
            member,
            freedBy: 'stop',
            workers: result.workers,
            roster: memberRosterOf(state)
          })
        : null
      const entry = await stopOne(client, target, result.workers)
      members.push(history ? { ...entry, history } : entry)
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
        member.closedTerminal ? `closed ${member.closedTerminal}` : '',
        member.alreadyClosedTerminal ? `${member.alreadyClosedTerminal} tab already closed` : ''
      ].filter(Boolean)
      return `${member.ticket ?? member.name} ${member.outcome}${done.length > 0 ? ` (${done.join(', ')})` : ''}${member.reason ? `: ${member.reason}` : ''}${member.history ? `\n  history ${member.history}` : ''}`
    })
    .join('\n')
}
