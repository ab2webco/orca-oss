import {
  DEFAULT_GAME_LEAD,
  DEFAULT_GAME_PUSH_PROMPT,
  renderGameLaunchPrompt
} from './orchestrator-game-lead'
import type { GameAgent, OrchestratorGameState } from './orchestrator-game-state'

/** What the lead's `orca game fleet|wave|sweep|push` decide from one `game.state` read. */

export type GameMemberPhase = 'needs-you' | 'working' | 'idle' | 'finished'

const PHASES: readonly GameMemberPhase[] = ['needs-you', 'working', 'idle', 'finished']

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
}

export type GameFleet = {
  rows: GameFleetRow[]
  counts: Record<GameMemberPhase, number>
  cap: number
  /** Members not finished: each holds a ticket and a slot. */
  running: number
  free: number
}

type FleetInput = Pick<OrchestratorGameState, 'agents' | 'lead'>

const TICKET = /(?:^|[^A-Z0-9])([A-Z][A-Z0-9_]*-\d+)(?![A-Z0-9])/

export function isFinishedMember(agent: GameAgent): boolean {
  const group = agent.workItem?.statusGroup
  return (
    agent.review?.state === 'merged' &&
    (group === undefined || group === 'review' || group === 'done')
  )
}

export function memberPhaseOf(agent: GameAgent): GameMemberPhase {
  if (isFinishedMember(agent)) {
    return 'finished'
  }
  if (agent.state === 'waiting') {
    return 'needs-you'
  }
  return agent.state === 'working' ? 'working' : 'idle'
}

// Why the name and branch: `game launch` names the member after its ticket before any ticket is linked.
export function ticketOfMember(agent: GameAgent): string | null {
  if (agent.workItem) {
    return agent.workItem.identifier.toUpperCase()
  }
  for (const text of [agent.displayName, agent.worktree?.displayName, agent.worktree?.branch]) {
    const match = text?.toUpperCase().match(TICKET)
    if (match?.[1]) {
      return match[1]
    }
  }
  return null
}

function nextOf(agent: GameAgent, phase: GameMemberPhase): string {
  const review = agent.review
  switch (phase) {
    case 'finished':
      return 'sweep --close'
    case 'needs-you':
      return 'answer it'
    case 'working':
      return 'wait'
  }
  if (!review) {
    return 'push'
  }
  if (review.state === 'merged') {
    return 'move the ticket to review'
  }
  if (review.state === 'closed') {
    return `check: PR #${review.number} closed`
  }
  if (review.ci === 'failure') {
    return 'push: CI failing'
  }
  return review.ci === 'pending' ? 'wait for CI' : `review PR #${review.number}`
}

function rowOf(agent: GameAgent): GameFleetRow {
  const phase = memberPhaseOf(agent)
  return {
    name: agent.displayName ?? agent.paneKey,
    ticket: ticketOfMember(agent),
    ticketStatus: agent.workItem ? agent.workItem.status || agent.workItem.statusGroup : null,
    state: agent.state,
    review: agent.review ? `#${agent.review.number} ${agent.review.state}` : null,
    ci: agent.review?.ci ?? null,
    branch: agent.worktree?.branch ?? null,
    phase,
    next: nextOf(agent, phase),
    terminalHandle: agent.terminalHandle ?? null
  }
}

const membersOf = (state: FleetInput): GameAgent[] =>
  state.agents.filter((agent) => agent.isMember && !agent.isLeader)

const byPhase = <T>(items: T[], phaseOf: (item: T) => GameMemberPhase): T[] =>
  items
    .map((item, index) => ({ item, index, rank: PHASES.indexOf(phaseOf(item)) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item)

export function gameFleetReportOf(state: FleetInput): GameFleet {
  const rows = byPhase(membersOf(state).map(rowOf), (row) => row.phase)
  const counts = { 'needs-you': 0, working: 0, idle: 0, finished: 0 }
  for (const row of rows) {
    counts[row.phase] += 1
  }
  const cap = (state.lead ?? DEFAULT_GAME_LEAD).cap
  const running = rows.length - counts.finished
  return { rows, counts, cap, running, free: Math.max(0, cap - running) }
}

export type GameWaveSkipReason = 'cap' | 'already running' | 'not in To Do'

export type GameWavePlan = {
  launch: string[]
  skipped: { ticket: string; reason: GameWaveSkipReason }[]
}

/** Named tickets, or the To Do's in list order, up to the free slots; never past the cap. */
export function gameWavePlanOf(
  state: FleetInput & Pick<OrchestratorGameState, 'project'>,
  requested: readonly string[]
): GameWavePlan {
  const fleet = gameFleetReportOf(state)
  const held = new Set(
    fleet.rows.filter((row) => row.phase !== 'finished').map((row) => row.ticket)
  )
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
      : group !== undefined && group !== 'todo'
        ? 'not in To Do'
        : plan.launch.length >= fleet.free
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

export type GameSweepEntry = { row: GameFleetRow; pending: string[] }

/** Finished members, each with what releasing its tab still leaves for someone to do. */
export function gameSweepOf(state: FleetInput): GameSweepEntry[] {
  return membersOf(state)
    .filter(isFinishedMember)
    .map((agent) => {
      const pending: string[] = []
      if (agent.worktree) {
        pending.push(`worktree ${agent.worktree.branch} stays`)
      }
      if (!agent.workItem) {
        pending.push('no linked ticket to confirm')
      } else if (agent.workItem.statusGroup !== 'done') {
        pending.push(
          `ticket ${agent.workItem.identifier} is ${agent.workItem.status || agent.workItem.statusGroup}, not done`
        )
      }
      if (!agent.terminalHandle) {
        pending.push('no terminal to close')
      }
      return { row: rowOf(agent), pending }
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
export function gamePushPlanOf(state: FleetInput): GamePushEntry[] {
  const template = state.lead?.pushPrompt ?? DEFAULT_GAME_PUSH_PROMPT
  const entries = membersOf(state)
    .filter((agent) => !isFinishedMember(agent))
    .map((agent): GamePushEntry => {
      const row = rowOf(agent)
      const base = { row }
      if (row.phase === 'needs-you') {
        return {
          ...base,
          action: 'needs-you',
          reason: 'waiting on a question or dialog: the person or the lead answers it'
        }
      }
      if (row.phase === 'working') {
        return { ...base, action: 'leave', reason: 'working' }
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
