import {
  memberPhaseOf,
  ticketOfMember,
  type GameMemberPhase
} from './orchestrator-game-fleet-verbs'
import type { GameAgent } from './orchestrator-game-state'
import { stripTerminalControl } from './terminal-control-stripping'
import { markClaudeUnsentInput } from './claude-unsent-input'

/** One member in one call, bounded so it fits in a lead's turn: `orca game member`. */

export const GAME_MEMBER_TERMINAL_LINES = 20
const LINE_MAX = 200
const MESSAGES_MAX = 10
export const GAME_MEMBER_BODY_MAX = 600
const COMMITS_MAX = 10
const SHORT_SHA = 7

export type GameMemberMessage = {
  at: string
  from: 'member' | 'lead'
  type: string
  subject: string
  body: string
}

export type GameMemberReport = {
  ticket: string | null
  name: string
  agent: string | null
  account: string | null
  branch: string | null
  terminalHandle: string | null
  /** The paired host it runs on; null when local (ORCA-824). */
  host: string | null
  now: {
    state: GameAgent['state']
    phase: GameMemberPhase
    tool: string | null
    activity: string | null
    limitedUntil: string | null
    /** The last terminal lines, oldest first, without escape codes. */
    terminal: string[]
    /** Text left in Claude's input box: never sent, whether typed or suggested (ORCA-859). */
    unsentInput: string | null
  }
  since: {
    /** Every attempt for its task, oldest first; the live one carries its stage. */
    dispatches: {
      id: string
      state: string
      stage?: string
      launchedAt?: string
      lastError?: string
    }[]
    /** Questions, answers and reports between it and the lead, oldest first. */
    messages: GameMemberMessage[]
    lastReport: GameMemberMessage | null
    commits: { id: string; subject: string; at: string | null }[]
    review: string | null
    ci: string | null
    ticketStatus: string | null
  }
  /** Parts Orca could not read this time, and why. */
  notes: string[]
}

export type GameMemberReportInput = {
  agent: GameAgent
  terminalLines: readonly string[] | null
  dispatches: readonly { dispatchId: string; workerState: string; terminalState?: string | null }[]
  /** The live dispatch's own record. */
  current: {
    state: string
    stage: string
    lastError: string | null
    launchedAt: string | null
  } | null
  messages: readonly {
    from_handle: string
    to_handle: string
    type: string
    subject: string
    body: string
    created_at: string
  }[]
  leadHandle: string | null
  commits: readonly { id: string; subject: string; timestamp?: number }[]
  notes: string[]
}

const cut = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text)

const REPORT_TYPES: ReadonlySet<string> = new Set(['worker_done', 'escalation'])

function messagesOf(input: GameMemberReportInput): GameMemberMessage[] {
  const own = input.agent.terminalHandle
  const lead = input.leadHandle
  return input.messages
    .filter(
      (one) =>
        own !== undefined &&
        ((one.from_handle === own && (lead === null || one.to_handle === lead)) ||
          (one.to_handle === own && (lead === null || one.from_handle === lead)))
    )
    .map((one) => ({
      at: one.created_at,
      from: one.from_handle === own ? ('member' as const) : ('lead' as const),
      type: one.type,
      subject: cut(one.subject, LINE_MAX),
      body: cut(one.body, GAME_MEMBER_BODY_MAX)
    }))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-MESSAGES_MAX)
}

export function gameMemberReportOf(input: GameMemberReportInput): GameMemberReport {
  const { agent } = input
  const live = input.dispatches.at(-1)
  const messages = messagesOf(input)
  const activity = agent.activity
  const terminal = markClaudeUnsentInput(
    (input.terminalLines ?? [])
      .map((line) => stripTerminalControl(line).trimEnd())
      .slice(-GAME_MEMBER_TERMINAL_LINES)
  )
  return {
    ticket: ticketOfMember(agent),
    name: agent.displayName ?? agent.paneKey,
    agent: agent.agentType,
    account: agent.account?.email ?? null,
    branch: agent.worktree?.branch ?? null,
    terminalHandle: agent.terminalHandle ?? null,
    host: agent.remote?.host ?? null,
    now: {
      state: agent.state,
      phase: memberPhaseOf(agent),
      tool: agent.toolName,
      activity: activity ? `${activity.running ? '▶ ' : ''}${activity.name} ${activity.id}` : null,
      limitedUntil:
        agent.limit?.resetsAt === undefined || agent.limit.resetsAt === null
          ? null
          : new Date(agent.limit.resetsAt).toISOString(),
      terminal: terminal.lines.map((line) => cut(line, LINE_MAX)),
      unsentInput: terminal.unsent === null ? null : cut(terminal.unsent, GAME_MEMBER_BODY_MAX)
    },
    since: {
      dispatches: input.dispatches.map((one) =>
        one === live && input.current
          ? {
              id: one.dispatchId,
              state: input.current.state,
              stage: input.current.stage,
              ...(input.current.launchedAt ? { launchedAt: input.current.launchedAt } : {}),
              ...(input.current.lastError
                ? { lastError: cut(input.current.lastError, LINE_MAX) }
                : {})
            }
          : { id: one.dispatchId, state: one.workerState }
      ),
      messages,
      lastReport:
        messages.findLast((one) => one.from === 'member' && REPORT_TYPES.has(one.type)) ?? null,
      commits: input.commits.slice(0, COMMITS_MAX).map((one) => ({
        id: one.id.slice(0, SHORT_SHA),
        subject: cut(one.subject, LINE_MAX),
        at: one.timestamp === undefined ? null : new Date(one.timestamp).toISOString()
      })),
      review: agent.review ? `#${agent.review.number} ${agent.review.state}` : null,
      ci: agent.review?.ci ?? null,
      ticketStatus: agent.workItem ? agent.workItem.status || agent.workItem.statusGroup : null
    },
    notes: input.notes
  }
}
