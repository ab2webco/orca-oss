import type { CommandHandler } from '../dispatch'
import type { GameStopWorker } from './orchestrator-game-stop'
import {
  gameHistoryOutcomeOf,
  type GameHistoryRecord
} from '../../shared/orchestrator-game-history'
import { ticketOfMember, type GameFleetRow } from '../../shared/orchestrator-game-fleet-verbs'
import {
  characterKeyOf,
  memberNameOf,
  type GameMemberName
} from '../../shared/orchestrator-game-member-names'
import type { GameAgent, OrchestratorGameState } from '../../shared/orchestrator-game-state'

type Client = Parameters<CommandHandler>[0]['client']

type InboxMessage = { from_handle: string; type: string; body: string; sequence?: number }

const REPORT_TYPES: ReadonlySet<string> = new Set(['worker_done', 'escalation'])
// Why 100: enough to reach a member's last report in a busy lead's inbox.
const INBOX_READ = 100

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** The member a fleet row was made from. */
export function agentOfRow(
  state: Pick<OrchestratorGameState, 'agents'>,
  row: Pick<GameFleetRow, 'ticket' | 'terminalHandle'>
): GameAgent | undefined {
  return state.agents.find(
    (agent) =>
      agent.isMember &&
      !agent.isLeader &&
      (agent.terminalHandle ?? null) === row.terminalHandle &&
      ticketOfMember(agent) === row.ticket
  )
}

async function launchedAtOf(
  client: Client,
  dispatchId: string | undefined
): Promise<string | null> {
  if (!dispatchId) {
    return null
  }
  const shown = await client
    .call<{ worker?: { created_at?: string } }>('orchestration.workerShow', {
      dispatch: dispatchId
    })
    .catch(() => null)
  return shown?.result?.worker?.created_at ?? null
}

/** The member's latest dispatch in any state: history reads it after the member ended (ORCA-1005). */
export function historyDispatchOf(
  member: Pick<GameAgent, 'paneKey' | 'remote' | 'terminalHandle' | 'worktree'>,
  workers: readonly GameStopWorker[]
): GameStopWorker | undefined {
  const remoteId = member.remote ? member.paneKey.replace(/^remote:/, '') : null
  const handle = member.terminalHandle ?? null
  const worktreeId = member.worktree?.id ?? null
  return (
    workers.findLast((worker) => remoteId !== null && worker.dispatchId === remoteId) ??
    workers.findLast((worker) => handle !== null && worker.agentTerminalHandle === handle) ??
    workers.findLast((worker) => worktreeId !== null && worker.resource?.worktreeId === worktreeId)
  )
}

async function lastReportOf(
  client: Client,
  member: GameAgent,
  dispatch: Pick<GameStopWorker, 'dispatchId' | 'runId'> | undefined
): Promise<string | null> {
  const lead = process.env.ORCA_TERMINAL_HANDLE
  // Why the run: a member's worker_done is addressed to `run:<id>`, not to the lead's terminal.
  const addresses = [lead, dispatch?.runId ? `run:${dispatch.runId}` : undefined].filter(
    (one): one is string => Boolean(one)
  )
  // Why the dispatch: a remote member's report is relayed from `dispatch:<id>`, with no terminal.
  const senders = new Set(
    [member.terminalHandle, dispatch ? `dispatch:${dispatch.dispatchId}` : undefined].filter(
      (one): one is string => Boolean(one)
    )
  )
  if (addresses.length === 0 || senders.size === 0) {
    return null
  }
  const reads = await Promise.all(
    addresses.map((terminal) =>
      client
        .call<{ messages?: InboxMessage[] }>('orchestration.inbox', { terminal, limit: INBOX_READ })
        .catch(() => null)
    )
  )
  const reports = reads
    .flatMap((read) => read?.result?.messages ?? [])
    .filter((one) => senders.has(one.from_handle) && REPORT_TYPES.has(one.type))
  // Why by sequence: each address lists newest first, but the two lists interleave.
  const newest = reports.reduce<InboxMessage | null>(
    (best, one) => (best === null || (one.sequence ?? 0) > (best.sequence ?? 0) ? one : best),
    null
  )
  return newest?.body ?? null
}

/**
 * Writes what a member leaves behind into the project's history, before it is freed.
 * Returns why it could not, so the caller still frees it and says so (an older Orca has no history).
 */
export async function recordFreedMember(args: {
  client: Client
  member: GameAgent
  freedBy: 'sweep' | 'stop'
  workers: readonly GameStopWorker[]
  /** The dispatch the caller frees, when it found it its own way. */
  dispatch?: Pick<GameStopWorker, 'dispatchId' | 'workerState' | 'runId'>
  /** The project's roster, which names the member's character in every language. */
  roster: readonly GameMemberName[]
}): Promise<string | null> {
  const { client, member } = args
  const character = memberNameOf(member.displayName)
  const dispatch = args.dispatch ?? historyDispatchOf(member, args.workers)
  const [launchedAt, lastReport] = await Promise.all([
    launchedAtOf(client, dispatch?.dispatchId),
    lastReportOf(client, member, dispatch)
  ])
  const record: GameHistoryRecord = {
    ticket: ticketOfMember(member),
    repo: null,
    branch: member.worktree?.branch ?? null,
    agent: member.agentType,
    account: member.account?.email ?? null,
    launchedAt,
    endedAt: new Date().toISOString(),
    outcome: gameHistoryOutcomeOf(member, args.freedBy, dispatch?.workerState),
    pr: member.review ? `#${member.review.number} ${member.review.state}` : null,
    lastReport,
    ...(character === null ? {} : { character }),
    ...(member.remote ? { host: member.remote.host } : {})
  }
  try {
    await client.call('game.historyRecord', {
      worktreeId: process.env.ORCA_WORKTREE_ID,
      terminalHandle: process.env.ORCA_TERMINAL_HANDLE,
      memberWorktreeId: member.worktree?.id,
      record,
      character: character ?? undefined,
      characterKey: character === null ? undefined : characterKeyOf(args.roster, character)
    })
    return null
  } catch (error) {
    return `not recorded: ${errorText(error)}`
  }
}
