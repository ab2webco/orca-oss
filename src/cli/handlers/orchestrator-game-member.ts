import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { readCallerGameState } from './orchestrator-game-launch'
import { dispatchOf, type GameStopWorker } from './orchestrator-game-stop'
import { ticketOfMember } from '../../shared/orchestrator-game-fleet-verbs'
import {
  GAME_MEMBER_TERMINAL_LINES,
  gameMemberReportOf,
  type GameMemberReport,
  type GameMemberReportInput
} from '../../shared/orchestrator-game-member-report'
import type { GameAgent, OrchestratorGameState } from '../../shared/orchestrator-game-state'
import type { GitHistoryResult } from '../../shared/git-history-types'
import type { RuntimeTerminalRead } from '../../shared/runtime-types'

type Client = Parameters<CommandHandler>[0]['client']

const COMMITS_READ = 10
// Why 100: enough to reach a member's thread in a lead's inbox; the report keeps the last 10.
const INBOX_READ = 100

type WorkerShow = {
  worker: { state: string; stage: string; last_error: string | null; created_at: string }
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Reads one part of the report; a part that fails becomes a note, never a failed command. */
async function part<T>(notes: string[], label: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (error) {
    notes.push(`${label}: ${errorText(error)}`)
    return null
  }
}

function memberOf(state: OrchestratorGameState, selector: string): GameAgent {
  const wanted = selector.trim()
  const member = state.agents.find(
    (agent) =>
      agent.isMember &&
      !agent.isLeader &&
      (agent.terminalHandle === wanted || ticketOfMember(agent) === wanted.toUpperCase())
  )
  if (!member) {
    throw new RuntimeClientError(
      'invalid_argument',
      `No member is ${wanted}; see \`orca game fleet\`, or \`orca game history\` for one already freed.`
    )
  }
  return member
}

async function inputOf(
  client: Client,
  state: OrchestratorGameState,
  member: GameAgent
): Promise<GameMemberReportInput> {
  const notes: string[] = []
  const handle = member.terminalHandle ?? null
  const leadHandle =
    state.agents.find((agent) => agent.isLeader)?.terminalHandle ??
    process.env.ORCA_TERMINAL_HANDLE ??
    null
  // Why: a remote member's terminal and worktree live on its host; the home dispatch reads them (ORCA-824).
  const remoteDispatchId = member.remote ? member.paneKey.replace(/^remote:/, '') : null
  const worktreeId = remoteDispatchId ? null : (member.worktree?.id ?? null)
  const [terminal, workers, leadInbox, memberInbox, history] = await Promise.all([
    remoteDispatchId
      ? part(
          notes,
          'terminal',
          async () =>
            (
              await client.call<{ terminal: RuntimeTerminalRead }>('orchestration.workerRead', {
                dispatch: remoteDispatchId,
                source: 'terminal',
                limit: GAME_MEMBER_TERMINAL_LINES
              })
            ).result.terminal.tail
        )
      : handle
        ? part(
            notes,
            'terminal',
            async () =>
              (
                await client.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
                  terminal: handle,
                  limit: GAME_MEMBER_TERMINAL_LINES
                })
              ).result.terminal.tail
          )
        : null,
    part(
      notes,
      'dispatches',
      async () =>
        (await client.call<{ workers: GameStopWorker[] }>('orchestration.workerList', {})).result
          .workers
    ),
    leadHandle ? part(notes, 'messages', () => readInbox(client, leadHandle)) : null,
    handle ? part(notes, 'messages', () => readInbox(client, handle)) : null,
    worktreeId
      ? part(
          notes,
          'commits',
          async () =>
            (
              await client.call<GitHistoryResult>('git.history', {
                worktree: `id:${worktreeId}`,
                limit: COMMITS_READ
              })
            ).result
        )
      : null
  ])
  const live = remoteDispatchId
    ? { dispatchId: remoteDispatchId, taskId: null }
    : dispatchOf({ row: { terminalHandle: handle }, worktreeId }, workers ?? [])
  const attempts = (workers ?? []).filter((one) =>
    live?.taskId ? one.taskId === live.taskId : one === live
  )
  const shown = live
    ? await part(
        notes,
        'dispatch',
        async () =>
          (await client.call<WorkerShow>('orchestration.workerShow', { dispatch: live.dispatchId }))
            .result.worker
      )
    : null
  const mergeBase = history?.mergeBase
  const ownCommits = history?.items ?? []
  const cutAt = mergeBase ? ownCommits.findIndex((one) => one.id === mergeBase) : -1
  return {
    agent: member,
    terminalLines: terminal,
    dispatches: attempts,
    current: shown && {
      state: shown.state,
      stage: shown.stage,
      lastError: shown.last_error,
      launchedAt: shown.created_at
    },
    messages: [...(leadInbox ?? []), ...(memberInbox ?? [])],
    leadHandle,
    commits: cutAt >= 0 ? ownCommits.slice(0, cutAt) : ownCommits,
    notes
  }
}

const readInbox = async (client: Client, terminal: string) =>
  (
    await client.call<{ messages: GameMemberReportInput['messages'] }>('orchestration.inbox', {
      terminal,
      limit: INBOX_READ
    })
  ).result.messages

export function formatGameMember(report: GameMemberReport): string {
  const { now, since } = report
  const lines = [
    `${report.ticket ?? report.name} · ${now.phase} · ${[report.agent, report.account, report.host && `on ${report.host}`].filter(Boolean).join(' · ')}${report.branch ? ` · ⎇ ${report.branch}` : ''}`,
    `now: ${now.state}${now.tool ? `, last tool ${now.tool}` : ''}${now.activity ? `, ${now.activity}` : ''}${now.limitedUntil ? `, limited until ${now.limitedUntil}` : ''}`,
    ...now.terminal.map((line) => `  | ${line}`),
    `PR ${since.review ?? '-'} · CI ${since.ci ?? '-'} · ticket ${since.ticketStatus ?? '-'}`,
    `dispatches: ${since.dispatches.map((one) => `${one.id} ${one.state}${one.stage ? ` (${one.stage})` : ''}`).join(', ') || '-'}`,
    ...since.messages.map(
      (one) => `  ${one.at} ${one.from} ${one.type}: ${one.body || one.subject}`
    ),
    ...since.commits.map((one) => `  ${one.id} ${one.subject}`),
    ...report.notes.map((note) => `(not read: ${note})`)
  ]
  return lines.join('\n')
}

export const ORCHESTRATOR_GAME_MEMBER_HANDLERS: Record<string, CommandHandler> = {
  'game member': async ({ flags, client, json }) => {
    const raw = flags.get('member')
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new RuntimeClientError(
        'invalid_argument',
        'Name the member by its ticket (CIN-12) or terminal handle.'
      )
    }
    const response = await readCallerGameState(client)
    const member = memberOf(response.result, raw)
    const report = gameMemberReportOf(await inputOf(client, response.result, member))
    printResult({ ...response, result: report }, json, formatGameMember)
  }
}
