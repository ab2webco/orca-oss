import { waitingOnYouNextOf } from './orchestrator-game-lead-wait'
import {
  memberTicketStatusOf,
  phaseNextOf,
  remoteNextOf,
  ticketOfMember
} from './orchestrator-game-member-next'
import {
  DEFAULT_GAME_LEAD,
  DEFAULT_GAME_PUSH_PROMPT,
  renderGameLaunchPrompt
} from './orchestrator-game-lead'
import type { GameWaitingMessage } from './orchestrator-game-inbox'
import type {
  GameAgent,
  GameReviewMergeState,
  GameStatusGroup,
  OrchestratorGameState
} from './orchestrator-game-state'
import { ticketInText } from './orchestrator-game-ticket-id'
import { gameMemberModelTextOf } from './team-panel-agent-model'
import { isFinishedMember } from './orchestrator-game-member-finished'
import { isLeftoverMember, leftoverNextOf } from './orchestrator-game-member-leftover'
import type { GamePausedMember } from './orchestrator-game-member-sessions'
import type { GameQueuedMember } from './orchestrator-game-queued-members'
import {
  gameFleetHostLoadsOf,
  LOCAL_GAME_HOST,
  localGameFreeOf,
  type GameHostLoad,
  type GameHostProjectLoad
} from './orchestrator-game-host-load'

import { byPhase, memberPhaseOf, type GameMemberPhase } from './orchestrator-game-member-phase'

export { ticketInText, ticketOfMember, isFinishedMember, localGameFreeOf, memberPhaseOf }
export type { GameMemberPhase }

/** What the lead's `orca game fleet|wave|sweep|push` decide from one `game.state` read. */

export type GameFleetRow = {
  name: string
  ticket: string | null
  ticketStatus: string | null
  state: GameAgent['state']
  /** `#41 open`, or null without a PR. */
  review: string | null
  reviewUrl: string | null
  ci: string | null
  /** GitHub's merge state: `unstable` or `clean` with red CI means only checks no rule requires failed. */
  mergeState: GameReviewMergeState | null
  branch: string | null
  phase: GameMemberPhase
  next: string
  terminalHandle: string | null
  agent: string | null
  /** The managed account's email; null when Orca's own selection applies or it cannot tell. */
  account: string | null
  /** Runs on the host's global login: no managed account, so `game move` cannot move it. */
  globalLogin: boolean
  /** The model and effort serving it (`Sonnet 5.5 → Opus 5.5 · high`); null when its host sent none. */
  model: string | null
  /** Who chose that model and why; null when no router or chooser is known (ORCA-851). */
  modelBy: string | null
  /** When a limited member's account resets (ISO); null when unknown or not limited. */
  limitedUntil: string | null
  /** When the host last saw its terminal work (ISO); null when unknown. */
  lastActivityAt: string | null
  /** When its hook last reported (ISO); null when its host sent none. */
  hookAt: string | null
  /** Its hook row was restored from disk and no hook confirmed it since. */
  restored: boolean
  /** Failed for silence yet still working; its ticket has another live attempt (ORCA-658). */
  orphaned: boolean
  /** The paired host a remote member runs on; null when local (ORCA-824). */
  host: string | null
  /** False while a remote member's host does not answer: `state` is then a guess. */
  stateKnown: boolean
  /** A remote member a lead that no longer leads it launched (ORCA-793). */
  earlierLead: boolean
  /** No `game launch` started it: only verbs that name it act on it (ORCA-914). */
  found: boolean
  /** Found, its agent neither working nor waiting: it loads no host; adopt or close it (ORCA-1424). */
  leftover: boolean
}

const ORPHANED_NEXT = 'orphaned, still working: adopt its work or stop it'

export type GameFleet = {
  rows: GameFleetRow[]
  counts: Record<GameMemberPhase, number>
  cap: number
  /** Members not finished and not gone from their host: each holds a ticket and a slot. */
  running: number
  free: number
  /** Running members and free slots per host, local first; absent when the state has no per-host caps. */
  hosts?: GameHostLoad[]
  /** Other projects' members on each host, counted against its cap; absent when there are none. */
  others?: GameHostProjectLoad[]
  /** Members not live now (terminal ended, Orca restarted or not reporting): `game resume-members`. */
  paused: GamePausedMember[]
  /** Members whose start waits for the setup in flight (ORCA-746). */
  queued: GameQueuedMember[]
  pausedError?: string
}

export type GameFleetInput = Pick<
  OrchestratorGameState,
  'agents' | 'lead' | 'hosts' | 'otherProjectMembers'
> &
  Pick<
    OrchestratorGameState,
    'pausedMembers' | 'pausedMembersError' | 'queuedMembers' | 'inboxes' | 'project'
  >

/** The PR urls the project's merge queue lists; empty while it is unread. */
export const mergeQueuedOf = (state: Pick<OrchestratorGameState, 'project'>): ReadonlySet<string> =>
  new Set(state.project?.queue?.entries?.map((entry) => entry.url))

export function gameFleetRowOf(
  agent: GameAgent,
  question?: GameWaitingMessage,
  queued?: ReadonlySet<string>,
  now = Date.now()
): GameFleetRow {
  const phase = memberPhaseOf(agent, now)
  const leftover = isLeftoverMember(agent)
  const name = agent.displayName ?? agent.paneKey
  return {
    name,
    ticket: ticketOfMember(agent),
    ticketStatus: memberTicketStatusOf(agent, queued),
    state: agent.state,
    review: agent.review ? `#${agent.review.number} ${agent.review.state}` : null,
    reviewUrl: agent.review?.url ?? null,
    ci: agent.review?.ci ?? null,
    mergeState: agent.review?.mergeState ?? null,
    branch: agent.worktree?.branch ?? null,
    phase,
    next: leftover
      ? leftoverNextOf(agent, ticketOfMember(agent) ?? name)
      : (remoteNextOf(agent, ticketOfMember(agent)) ??
        nextWithQuestionOf(agent, phase, question, queued)),
    terminalHandle: agent.terminalHandle ?? null,
    agent: agent.agentType,
    account: agent.account?.email ?? null,
    globalLogin: agent.globalLogin === true,
    ...gameMemberModelTextOf(agent),
    limitedUntil:
      agent.limit?.resetsAt === null || agent.limit === undefined
        ? null
        : new Date(agent.limit.resetsAt).toISOString(),
    lastActivityAt: agent.lastActivityAt ?? null,
    hookAt: agent.hookAt === undefined ? null : new Date(agent.hookAt).toISOString(),
    restored: agent.restored === true,
    orphaned: agent.orphaned === true,
    host: agent.remote?.host ?? null,
    stateKnown: agent.remote?.stateKnown !== false,
    earlierLead: agent.remote?.earlierLead === true,
    found: agent.found === true,
    leftover
  }
}

// Why (ORCA-746 T6): an unanswered question outlives its acked mail, so the fleet keeps asking for the reply.
function nextWithQuestionOf(
  agent: GameAgent,
  phase: GameMemberPhase,
  question: GameWaitingMessage | undefined,
  queued: ReadonlySet<string> | undefined
): string {
  if (question && phase !== 'finished') {
    return waitingOnYouNextOf(question)
  }
  return agent.orphaned && phase !== 'finished' ? ORPHANED_NEXT : phaseNextOf(agent, phase, queued)
}

export const gameFleetMembersOf = (state: GameFleetInput): GameAgent[] =>
  state.agents.filter((agent) => agent.isMember && !agent.isLeader)

export function gameFleetReportOf(state: GameFleetInput, now = Date.now()): GameFleet {
  // Why: questions reach the lead's inbox, and each asking member is one ticket there.
  const waiting = state.inboxes?.find((inbox) => inbox.key === 'lead')?.waiting ?? []
  const mergeQueued = mergeQueuedOf(state)
  const rows = byPhase(
    gameFleetMembersOf(state).map((agent) =>
      gameFleetRowOf(
        agent,
        waiting.find((question) => question.from === ticketOfMember(agent)),
        mergeQueued,
        now
      )
    ),
    (row) => row.phase
  )
  const counts: Record<GameMemberPhase, number> = {
    'needs-you': 0,
    limited: 0,
    unknown: 0,
    working: 0,
    asleep: 0,
    idle: 0,
    finished: 0
  }
  for (const row of rows) {
    counts[row.phase] += 1
  }
  const cap = (state.lead ?? DEFAULT_GAME_LEAD).cap
  // Why paused ones count: each holds its ticket until resumed or discarded; with its worktree gone
  // nothing can run it again, so it holds no slot (ORCA-832).
  const holding = (state.pausedMembers ?? []).filter((one) => !one.worktreeGone)
  const queued = state.queuedMembers ?? []
  // Why gone ones do not: their host answered that the terminal is gone, so nothing runs there (ORCA-864).
  // Why found ones do not either: no wave launched them, so they hold no launch slot (ORCA-914).
  const slotless = gameFleetMembersOf(state).filter(
    (agent) => (agent.remote?.gone || agent.found) && !isFinishedMember(agent)
  )
  const running = rows.length - counts.finished - slotless.length + holding.length + queued.length
  const others = state.otherProjectMembers ?? []
  // Why every member here: a found session with a live agent still loads its machine (ORCA-1424).
  const hosts =
    state.hosts &&
    gameFleetHostLoadsOf(
      state.hosts,
      gameFleetMembersOf(state),
      holding.length + queued.length,
      others
    )
  const here = hosts
    ? 0
    : others.reduce((total, one) => total + (one.host === LOCAL_GAME_HOST ? one.running : 0), 0)
  const free = Math.max(0, cap - running - here)
  const hostsFree = hosts?.reduce((total, one) => total + one.free, 0) ?? free
  return {
    rows,
    counts,
    cap,
    running,
    free: Math.min(free, hostsFree),
    ...(hosts ? { hosts } : {}),
    ...(others.length > 0 ? { others } : {}),
    paused: state.pausedMembers ?? [],
    queued,
    ...(state.pausedMembersError ? { pausedError: state.pausedMembersError } : {})
  }
}

// Why In Progress is allowed: a project may move a ticket there before its launch (cineco does).
const PAST_WORK: ReadonlySet<GameStatusGroup> = new Set(['review', 'done', 'cancelled'])

export type GameWaveSkipReason = 'cap' | 'already running' | 'paused' | 'queued' | 'not in To Do'

export type GameWavePlan = {
  launch: string[]
  skipped: { ticket: string; reason: GameWaveSkipReason }[]
}

/** Named tickets, or the To Do's in list order, up to this Orca's free slots; never past the cap. */
export function gameWavePlanOf(
  state: GameFleetInput & Pick<OrchestratorGameState, 'project'>,
  requested: readonly string[]
): GameWavePlan {
  const fleet = gameFleetReportOf(state)
  const held = new Set(
    fleet.rows.filter((row) => row.phase !== 'finished').map((row) => row.ticket)
  )
  const paused = new Set(fleet.paused.map((one) => one.ticket))
  const queued = new Set(fleet.queued.map((one) => one.ticket))
  const items = state.project?.todo?.items ?? []
  const groupOf = (ticket: string) => items.find((item) => item.id.toUpperCase() === ticket)?.group
  const named = [...new Set(requested.map((ticket) => ticket.trim().toUpperCase()))].filter(
    (ticket) => ticket !== ''
  )
  const candidates =
    named.length > 0
      ? named
      : items.filter((item) => item.group === 'todo').map((item) => item.id.toUpperCase())
  const plan: GameWavePlan = { launch: [], skipped: [] }
  for (const ticket of candidates) {
    const group = groupOf(ticket)
    const reason: GameWaveSkipReason | null = held.has(ticket)
      ? 'already running'
      : paused.has(ticket)
        ? 'paused'
        : queued.has(ticket)
          ? 'queued'
          : group !== undefined && PAST_WORK.has(group)
            ? 'not in To Do'
            : plan.launch.length >= localGameFreeOf(fleet)
              ? 'cap'
              : null
    if (reason) {
      plan.skipped.push({ ticket, reason })
    } else {
      plan.launch.push(ticket)
    }
  }
  return plan
}

export type GamePushEntry = {
  row: GameFleetRow
  action: 'push' | 'leave' | 'needs-you'
  reason: string
  /** What is sent, only for `push`. */
  prompt?: string
}

/** Every member not finished: idle ones get the project's continue prompt, the rest are left alone. */
export function gamePushPlanOf(state: GameFleetInput): GamePushEntry[] {
  const template = state.lead?.pushPrompt ?? DEFAULT_GAME_PUSH_PROMPT
  const entries = gameFleetMembersOf(state)
    .filter((agent) => !isFinishedMember(agent))
    .map((agent): GamePushEntry => {
      const row = gameFleetRowOf(agent)
      const base = { row }
      if (row.phase === 'needs-you') {
        return {
          ...base,
          action: 'needs-you',
          reason: 'waiting on a question or dialog: the person or the lead answers it'
        }
      }
      if (row.found) {
        return { ...base, action: 'leave', reason: 'found: not launched by this lead' }
      }
      if (row.phase === 'working') {
        return { ...base, action: 'leave', reason: 'working' }
      }
      if (row.phase === 'limited') {
        return { ...base, action: 'leave', reason: `limited by its account: ${row.next}` }
      }
      if (row.phase === 'unknown' || row.phase === 'asleep') {
        return { ...base, action: 'leave', reason: `${row.phase}: ${row.next}` }
      }
      if (!row.terminalHandle) {
        return { ...base, action: 'leave', reason: 'no terminal to send to' }
      }
      const prompt = renderGameLaunchPrompt(template, {
        id: row.ticket ?? '',
        title: agent.workItem?.title ?? '',
        url: agent.workItem?.url ?? '',
        status: agent.workItem?.status
      })
      return { ...base, action: 'push', reason: 'idle', prompt }
    })
  return byPhase(entries, (entry) => entry.row.phase)
}
