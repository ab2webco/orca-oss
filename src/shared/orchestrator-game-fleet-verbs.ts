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
import type { GameAgent, GameStatusGroup, OrchestratorGameState } from './orchestrator-game-state'
import { ticketInText } from './orchestrator-game-ticket-id'
import { finishedSignalOf, isFinishedMember } from './orchestrator-game-member-finished'
import type { GamePausedMember, GameQueuedMember } from './orchestrator-game-member-sessions'
import {
  gameFleetHostLoadsOf,
  localGameFreeOf,
  type GameHostLoad
} from './orchestrator-game-host-load'

export { ticketInText, ticketOfMember, isFinishedMember, localGameFreeOf }

/** What the lead's `orca game fleet|wave|sweep|push` decide from one `game.state` read. */

export type GameMemberPhase = 'needs-you' | 'limited' | 'working' | 'idle' | 'finished'

const PHASES: readonly GameMemberPhase[] = ['needs-you', 'limited', 'working', 'idle', 'finished']

export type GameFleetRow = {
  name: string
  ticket: string | null
  ticketStatus: string | null
  state: GameAgent['state']
  /** `#41 open`, or null without a PR. */
  review: string | null
  ci: string | null
  branch: string | null
  phase: GameMemberPhase
  next: string
  terminalHandle: string | null
  agent: string | null
  /** The managed account's email; null when Orca's own selection applies or it cannot tell. */
  account: string | null
  /** Runs on the host's global login: no managed account, so `game move` cannot move it. */
  globalLogin: boolean
  /** When a limited member's account resets (ISO); null when unknown or not limited. */
  limitedUntil: string | null
  /** When the host last saw its terminal work (ISO); null when unknown. */
  lastActivityAt: string | null
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
  /** Members not live since Orca or the machine restarted: `game resume-members`. */
  paused: GamePausedMember[]
  /** Members whose start waits for the setup in flight (ORCA-746). */
  queued: GameQueuedMember[]
  pausedError?: string
}

export type GameFleetInput = Pick<OrchestratorGameState, 'agents' | 'lead' | 'hosts'> &
  Pick<OrchestratorGameState, 'pausedMembers' | 'pausedMembersError' | 'queuedMembers' | 'inboxes'>

export function memberPhaseOf(agent: GameAgent): GameMemberPhase {
  if (isFinishedMember(agent)) {
    return 'finished'
  }
  if (agent.limit?.loggedOut) {
    return 'needs-you'
  }
  if (agent.limit) {
    return 'limited'
  }
  if (agent.state === 'waiting') {
    return 'needs-you'
  }
  return agent.state === 'working' ? 'working' : 'idle'
}

export function gameFleetRowOf(agent: GameAgent, question?: GameWaitingMessage): GameFleetRow {
  const phase = memberPhaseOf(agent)
  return {
    name: agent.displayName ?? agent.paneKey,
    ticket: ticketOfMember(agent),
    ticketStatus: memberTicketStatusOf(agent),
    state: agent.state,
    review: agent.review ? `#${agent.review.number} ${agent.review.state}` : null,
    ci: agent.review?.ci ?? null,
    branch: agent.worktree?.branch ?? null,
    phase,
    next: remoteNextOf(agent, ticketOfMember(agent)) ?? nextWithQuestionOf(agent, phase, question),
    terminalHandle: agent.terminalHandle ?? null,
    agent: agent.agentType,
    account: agent.account?.email ?? null,
    globalLogin: agent.globalLogin === true,
    limitedUntil:
      agent.limit?.resetsAt === null || agent.limit === undefined
        ? null
        : new Date(agent.limit.resetsAt).toISOString(),
    lastActivityAt: agent.lastActivityAt ?? null,
    orphaned: agent.orphaned === true,
    host: agent.remote?.host ?? null,
    stateKnown: agent.remote?.stateKnown !== false,
    earlierLead: agent.remote?.earlierLead === true,
    found: agent.found === true
  }
}

// Why (ORCA-746 T6): an unanswered question outlives its acked mail, so the fleet keeps asking for the reply.
function nextWithQuestionOf(
  agent: GameAgent,
  phase: GameMemberPhase,
  question: GameWaitingMessage | undefined
): string {
  if (question && phase !== 'finished') {
    return `waiting on you: orchestration reply --id ${question.id}`
  }
  return agent.orphaned && phase !== 'finished' ? ORPHANED_NEXT : phaseNextOf(agent, phase)
}

export const gameFleetMembersOf = (state: GameFleetInput): GameAgent[] =>
  state.agents.filter((agent) => agent.isMember && !agent.isLeader)

const byPhase = <T>(items: T[], phaseOf: (item: T) => GameMemberPhase): T[] =>
  items
    .map((item, index) => ({ item, index, rank: PHASES.indexOf(phaseOf(item)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item)

export function gameFleetReportOf(state: GameFleetInput): GameFleet {
  // Why: questions reach the lead's inbox, and each asking member is one ticket there.
  const waiting = state.inboxes?.find((inbox) => inbox.key === 'lead')?.waiting ?? []
  const rows = byPhase(
    gameFleetMembersOf(state).map((agent) =>
      gameFleetRowOf(
        agent,
        waiting.find((question) => question.from === ticketOfMember(agent))
      )
    ),
    (row) => row.phase
  )
  const counts = { 'needs-you': 0, limited: 0, working: 0, idle: 0, finished: 0 }
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
  // Why every member here: a found session still loads the machine it runs on.
  const hosts =
    state.hosts &&
    gameFleetHostLoadsOf(state.hosts, gameFleetMembersOf(state), holding.length + queued.length)
  const free = Math.max(0, cap - running)
  const hostsFree = hosts?.reduce((total, one) => total + one.free, 0) ?? free
  return {
    rows,
    counts,
    cap,
    running,
    free: Math.min(free, hostsFree),
    ...(hosts ? { hosts } : {}),
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

export type GameSweepEntry = {
  row: GameFleetRow
  /** Why it counts as finished, with the live state that let it through. */
  reason: string
  pending: string[]
}

/** Finished members, each with what releasing its tab still leaves for someone to do. */
export function gameSweepOf(state: GameFleetInput): GameSweepEntry[] {
  return gameFleetMembersOf(state)
    .filter((agent) => !agent.found && isFinishedMember(agent))
    .map((agent) => {
      const pending: string[] = []
      if (agent.worktree) {
        pending.push(`worktree ${agent.worktree.branch} stays`)
      }
      if (!agent.workItem && !agent.remote?.ticketDone) {
        pending.push('no linked ticket to confirm')
      } else if (agent.workItem && agent.workItem.statusGroup !== 'done') {
        pending.push(
          `ticket ${agent.workItem.identifier} is ${agent.workItem.status || agent.workItem.statusGroup}, not done`
        )
      }
      if (!agent.terminalHandle) {
        pending.push('no terminal to close')
      }
      return {
        row: gameFleetRowOf(agent),
        reason: `${finishedSignalOf(agent)}; agent ${agent.state}`,
        pending
      }
    })
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
