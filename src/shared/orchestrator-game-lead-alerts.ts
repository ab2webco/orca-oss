import {
  gameFleetMembersOf,
  gameFleetReportOf,
  mergeQueuedOf,
  ticketOfMember,
  type GameFleetInput,
  type GameFleetRow
} from './orchestrator-game-fleet-verbs'
import { remoteNextOf } from './orchestrator-game-member-next'
import type { GameQueueEntry } from './orchestrator-game-project-work'
import {
  queueDepartureLineOf,
  unprovenQueueDepartureLineOf,
  type GameQueueDeparture
} from './orchestrator-game-queue-departure'
import { GAME_LEAD_REPLY_ALERT_MINUTES, leadWaitAlertsOf } from './orchestrator-game-lead-wait'
import type { OrchestratorGameState } from './orchestrator-game-state'

/** What `orca game watch --lead` prints: one line per condition the lead must act on (ORCA-1214). */

export const GAME_LEAD_ALERT_BUDGETS_MS = {
  queueEntry: 180 * 60_000,
  queueRun: 60 * 60_000,
  queuedLaunch: 20 * 60_000,
  undeliveredMail: 10 * 60_000
} as const

export type GameLeadAlert = { key: string; line: string }

export type GameLeadAlertInput = GameFleetInput &
  Pick<OrchestratorGameState, 'project' | 'duplicateLead'>

/** What one watch remembers between reads: no host keeps these clocks or the previous queue. */
export type GameLeadAlertMemory = {
  /** Merge-queue entries at the last read that could see the queue; null before the first. */
  queue: GameQueueEntry[] | null
  /** When this watch first saw each entry run its checks, by PR id. */
  checksSince: Map<string, number>
  /** When this watch first saw each launch waiting on setup, by ticket. */
  queuedSince: Map<string, number>
  /** GitHub's own word on each entry that just left, read by the watch before wording it (ORCA-1273). */
  departures: Map<string, GameQueueDeparture>
}

export const emptyGameLeadAlertMemory = (): GameLeadAlertMemory => ({
  queue: null,
  checksSince: new Map(),
  queuedSince: new Map(),
  departures: new Map()
})

const minutesOf = (ms: number): number => Math.floor(ms / 60_000)

// Why by pane, not ticket: a relaunch can fail while the first failed start is still listed (ORCA-1398).
function startFailedAlertsOf(state: GameLeadAlertInput): GameLeadAlert[] {
  return gameFleetMembersOf(state).flatMap((agent) => {
    const ticket = ticketOfMember(agent)
    const next = agent.remote?.startFailed ? remoteNextOf(agent, ticket) : null
    const who = ticket ?? agent.displayName ?? agent.paneKey
    return next ? [{ key: `start-failed:${agent.paneKey}`, line: `${who} ${next}` }] : []
  })
}

// Why (ORCA-1431): GitHub reads these only once every required check passed; the rollup also counts optional ones.
const REQUIRED_CHECKS_PASSED: ReadonlySet<string> = new Set(['clean', 'unstable'])

/** The red-CI line, naming GitHub's merge state; null when a required check cannot be what is red. */
function ciRedLineOf(row: GameFleetRow, queued: ReadonlySet<string>): string | null {
  if (row.ci !== 'failure' || row.phase === 'finished') {
    return null
  }
  // Why: the queue admits a PR only with its required checks green, and its own alerts cover the run.
  if (
    (row.reviewUrl && queued.has(row.reviewUrl)) ||
    REQUIRED_CHECKS_PASSED.has(row.mergeState ?? '')
  ) {
    return null
  }
  return `CI red on ${row.review ?? 'no PR'}, merge state ${row.mergeState ?? 'unread'}: give it its next step now.`
}

// Why (ORCA-1431): a member's own review read misses a PR its branch does not head, or fails and reads as none.
function hasPrNamingTicket(state: GameLeadAlertInput, ticket: string | null): boolean {
  if (!ticket) {
    return false
  }
  const named = new RegExp(`(?:^|[^A-Z0-9])${ticket.replace(/[^A-Z0-9_-]/gi, '')}(?![A-Z0-9])`, 'i')
  const queued = state.project?.queue?.entries ?? []
  const open = state.project?.reviews?.items ?? []
  return [...queued, ...open].some((one) => named.test(one.title))
}

/** What the idle-with-no-PR line read, so the lead can tell a missing PR from a missed one. */
function noPrEvidenceOf(state: GameLeadAlertInput, row: GameFleetRow): string {
  const branch = row.branch ? `none for ${row.branch}` : 'no branch read'
  const lists = [
    state.project?.reviews ? 'open PRs' : null,
    state.project?.queue?.entries ? 'merge queue' : null
  ].filter((one) => one !== null)
  const named =
    row.ticket && lists.length > 0 ? `, none naming ${row.ticket} in ${lists.join(' or ')}` : ''
  return `${branch}${named}`
}

function memberAlertsOf(state: GameLeadAlertInput, memory: GameLeadAlertMemory, now: number) {
  const fleet = gameFleetReportOf(state, now)
  const queued = mergeQueuedOf(state)
  const alerts: GameLeadAlert[] = []
  const add = (who: string, kind: string, line: string): void => {
    alerts.push({ key: `${kind}:${who}`, line: `${who} ${line}` })
  }
  for (const row of fleet.rows) {
    const who = row.ticket ?? row.name
    const review = row.review ?? 'no PR'
    if (row.next.startsWith('failed to start on ')) {
      // Alerted per start by startFailedAlertsOf.
    } else if (row.next.startsWith('gone from ')) {
      add(who, 'gone', `${row.next}. Compare its host worktree head with the pushed branch first.`)
    } else if (row.review?.endsWith(' merged')) {
      add(
        who,
        'merged',
        `PR ${review}: ticket to done with a comment, remove its worktree and branch, free it (${row.next}).`
      )
    } else if (row.phase === 'limited' || row.phase === 'needs-you') {
      add(who, row.phase, `${row.phase === 'limited' ? 'limited' : 'needs you'}: ${row.next}`)
    } else if (row.orphaned) {
      add(who, 'orphaned', row.next)
    } else if (!row.stateKnown && row.phase === 'unknown') {
      // Why: these rows left idle, whose alert was the only one that named the silent host (ORCA-1395).
      add(who, 'silent-host', row.next)
    } else if (
      row.phase === 'idle' &&
      row.review === null &&
      !hasPrNamingTicket(state, row.ticket)
    ) {
      add(who, 'idle-no-pr', `idle with no PR (${noPrEvidenceOf(state, row)}): ${row.next}`)
    }
    const ciRed = ciRedLineOf(row, queued)
    if (ciRed) {
      add(who, `ci-red:${review}`, ciRed)
    }
  }
  for (const one of fleet.paused) {
    const why = one.lastState ? ` (last ${one.lastState})` : ''
    add(
      one.ticket,
      'paused',
      `paused${why}: orca game resume-members ${one.ticket}, or --discard to free it`
    )
  }
  const queuedNow = new Set(fleet.queued.map((one) => one.ticket))
  for (const ticket of memory.queuedSince.keys()) {
    if (!queuedNow.has(ticket)) {
      memory.queuedSince.delete(ticket)
    }
  }
  for (const one of fleet.queued) {
    const since = memory.queuedSince.get(one.ticket) ?? now
    memory.queuedSince.set(one.ticket, since)
    if (now - since >= GAME_LEAD_ALERT_BUDGETS_MS.queuedLaunch) {
      add(
        one.ticket,
        'queued',
        `launch queued ${minutesOf(now - since)}+ min, waiting on ${one.waitingOn}`
      )
    }
  }
  return alerts
}

/** Entries the last read listed that this read does not; none while the queue is unread. */
export function queueLeftOf(state: GameLeadAlertInput, memory: GameLeadAlertMemory) {
  const entries = state.project?.queue?.entries
  const ids = new Set(entries?.map((one) => one.id))
  return entries ? (memory.queue?.filter((one) => !ids.has(one.id)) ?? []) : []
}

function leftQueueLineOf(
  entry: GameQueueEntry,
  state: GameLeadAlertInput,
  memory: GameLeadAlertMemory
): string {
  const departure = memory.departures.get(entry.id)
  if (departure) {
    return queueDepartureLineOf(entry.id, departure)
  }
  // Why not "open" too: the cached review still says open after the queue merged it (#1304, #1404).
  const member = state.agents.find((agent) => agent.review?.url === entry.url)?.review
  return member?.state === 'merged'
    ? `${entry.id} merged from the queue: close its ticket and clean up its member.`
    : unprovenQueueDepartureLineOf(entry.id)
}

function queueAlertsOf(state: GameLeadAlertInput, memory: GameLeadAlertMemory, now: number) {
  const entries = state.project?.queue?.entries
  // Why: an unread queue (absent, or null on a low budget) says nothing about what left it.
  if (!entries) {
    return []
  }
  const alerts: GameLeadAlert[] = []
  for (const gone of queueLeftOf(state, memory)) {
    // Why the time in the key: the next drop of the same PR is news again.
    alerts.push({ key: `left:${gone.id}:${now}`, line: leftQueueLineOf(gone, state, memory) })
  }
  memory.departures.clear()
  for (const id of memory.checksSince.keys()) {
    if (!entries.some((one) => one.id === id && one.state === 'checks')) {
      memory.checksSince.delete(id)
    }
  }
  for (const entry of entries) {
    if (entry.state === 'failed') {
      alerts.push({
        key: `failed:${entry.id}`,
        line: `${entry.id} failed in the merge queue: find the cause.`
      })
    }
    if (entry.since !== null && now - entry.since >= GAME_LEAD_ALERT_BUDGETS_MS.queueEntry) {
      alerts.push({
        key: `stuck:${entry.id}`,
        line: `${entry.id} in the merge queue ${minutesOf(now - entry.since)}+ min, past its budget: find why.`
      })
    }
    if (entry.state === 'checks') {
      const since = memory.checksSince.get(entry.id) ?? now
      memory.checksSince.set(entry.id, since)
      if (now - since >= GAME_LEAD_ALERT_BUDGETS_MS.queueRun) {
        alerts.push({
          key: `run:${entry.id}`,
          line: `${entry.id} queue run ${minutesOf(now - since)}+ min, past its budget: check the merge_group run.`
        })
      }
    }
  }
  memory.queue = entries
  return alerts
}

// Why past, not at: launches stop at the cap, so only a member's own `gh pr create` passes it (ORCA-1301).
function prCapAlertsOf(state: GameLeadAlertInput): GameLeadAlert[] {
  const open = state.project?.reviews?.total
  const { cap } = gameFleetReportOf(state)
  return open !== undefined && open > cap
    ? [
        {
          key: `pr-cap:${open}`,
          line: `${open} open PRs, past the project's cap of ${cap}: a member opened PRs past it. Find who (gh pr list --author @me) and stop it before it opens more.`
        }
      ]
    : []
}

// Why: a send to a remote member returned ok while its host never took it (ORCA-1301).
function undeliveredMailAlertsOf(state: GameLeadAlertInput, now: number): GameLeadAlert[] {
  return state.agents.flatMap((agent) => {
    const remote = agent.remote
    const since = remote?.undeliveredSince ? Date.parse(remote.undeliveredSince) : Number.NaN
    if (
      !remote ||
      agent.state === 'done' ||
      !(now - since >= GAME_LEAD_ALERT_BUDGETS_MS.undeliveredMail)
    ) {
      return []
    }
    const who = ticketOfMember(agent) ?? agent.displayName ?? agent.paneKey
    const pane = agent.terminalHandle
      ? `orca terminal send --environment ${remote.host} --terminal ${agent.terminalHandle}`
      : `orca game member ${who}`
    return [
      {
        key: `undelivered:${who}:${remote.undeliveredSince}`,
        line: remote.undeliveredReason
          ? `${who} has not received lead mail for ${minutesOf(now - since)}+ min: ${remote.host} did not take it (${remote.undeliveredReason}), so the member has not seen it. Reach the pane: ${pane}`
          : `${who} has not received lead mail for ${minutesOf(now - since)}+ min: ${remote.host} has not taken it, so the member has not seen it. Check the host, or reach the pane: ${pane}`
      }
    ]
  })
}

// Why first: two leads on one conversation both read its mail and queue merges (ORCA-1283).
function duplicateLeadAlertsOf(state: GameLeadAlertInput): GameLeadAlert[] {
  const terminals = state.duplicateLead?.terminals ?? []
  if (terminals.length < 2) {
    return []
  }
  return [
    {
      key: `duplicate-lead:${terminals.join(',')}`,
      line: `lead conversation live in ${terminals.length} panes (${terminals.join(', ')}): keep one, close the others (orca terminal close --terminal <handle>).`
    }
  ]
}

/** Every alert that holds now; `memory` is updated in place for the next read. */
export function gameLeadAlertsOf(
  state: GameLeadAlertInput,
  memory: GameLeadAlertMemory,
  now: number
): GameLeadAlert[] {
  return [
    ...duplicateLeadAlertsOf(state),
    ...startFailedAlertsOf(state),
    ...memberAlertsOf(state, memory, now),
    ...undeliveredMailAlertsOf(state, now),
    ...prCapAlertsOf(state),
    ...leadWaitAlertsOf(
      state.inboxes?.find((inbox) => inbox.key === 'lead')?.waiting ?? [],
      state.lead?.replyAlertMinutes ?? GAME_LEAD_REPLY_ALERT_MINUTES,
      now
    ),
    ...queueAlertsOf(state, memory, now)
  ]
}

/** The alerts not printed yet; a cleared alert is forgotten so it prints again when it returns. */
export function newGameLeadAlertsOf(
  alerts: readonly GameLeadAlert[],
  printed: Set<string>
): GameLeadAlert[] {
  const holding = new Set(alerts.map((one) => one.key))
  for (const key of printed) {
    if (!holding.has(key)) {
      printed.delete(key)
    }
  }
  const fresh = alerts.filter((one) => !printed.has(one.key))
  for (const one of fresh) {
    printed.add(one.key)
  }
  return fresh
}
