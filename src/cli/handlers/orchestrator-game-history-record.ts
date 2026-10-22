import type { CommandHandler } from '../dispatch'
import { dispatchOf, type GameStopWorker } from './orchestrator-game-stop'
import {
  gameHistoryOutcomeOf,
  type GameHistoryRecord
} from '../../shared/orchestrator-game-history'
import { ticketOfMember, type GameFleetRow } from '../../shared/orchestrator-game-fleet-verbs'
import { memberNameOf } from '../../shared/orchestrator-game-member-names'
import type { GameAgent, OrchestratorGameState } from '../../shared/orchestrator-game-state'

type Client = Parameters<CommandHandler>[0]['client']

type InboxMessage = { from_handle: string; type: string; body: string }

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

async function lastReportOf(client: Client, member: GameAgent): Promise<string | null> {
  const lead = process.env.ORCA_TERMINAL_HANDLE
  if (!lead || !member.terminalHandle) {
    return null
  }
  const inbox = await client
    .call<{ messages?: InboxMessage[] }>('orchestration.inbox', {
      terminal: lead,
      limit: INBOX_READ
    })
    .catch(() => null)
  // Why find: the inbox lists newest first.
  const report = (inbox?.result?.messages ?? []).find(
    (one) => one.from_handle === member.terminalHandle && REPORT_TYPES.has(one.type)
  )
  return report?.body ?? null
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
  dispatch?: Pick<GameStopWorker, 'dispatchId' | 'workerState'>
}): Promise<string | null> {
  const { client, member } = args
  const dispatch =
    args.dispatch ??
    dispatchOf(
      {
        row: { terminalHandle: member.terminalHandle ?? null },
        worktreeId: member.worktree?.id ?? null
      },
      [...args.workers]
    )
  const [launchedAt, lastReport] = await Promise.all([
    launchedAtOf(client, dispatch?.dispatchId),
    lastReportOf(client, member)
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
    lastReport
  }
  try {
    await client.call('game.historyRecord', {
      worktreeId: process.env.ORCA_WORKTREE_ID,
      terminalHandle: process.env.ORCA_TERMINAL_HANDLE,
      memberWorktreeId: member.worktree?.id,
      record,
      character: memberNameOf(member.displayName) ?? undefined
    })
    return null
  } catch (error) {
    return `not recorded: ${errorText(error)}`
  }
}
