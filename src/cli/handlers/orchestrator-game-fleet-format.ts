import { formatGameLaunch, type GameLaunchResult } from './orchestrator-game-launch-result'
import { GAME_GLOBAL_LOGIN_LABEL } from './orchestrator-game-launch-account'
import { formatStop, type GameStopResult } from './orchestrator-game-stop'
import type { GameHold } from './orchestrator-game-hold'
import { formatSetupQueue } from './orchestrator-game-setup-queue'
import {
  formatGameGitHubBudget,
  type GameGitHubBudget
} from '../../shared/orchestrator-game-github-budget'
import {
  formatGameHostCapacity,
  type GameHostCapacity
} from '../../shared/orchestrator-game-host-capacity'
import type {
  GameFleet,
  GameFleetRow,
  GamePushEntry,
  GameSweepEntry,
  GameWavePlan
} from '../../shared/orchestrator-game-fleet-verbs'
import {
  gameHostLoadLineOf,
  LOCAL_GAME_HOST,
  type GameHostLoad
} from '../../shared/orchestrator-game-host-load'

/** Text output of `orca game fleet|wave|sweep|push`; `--json` prints the results as they are. */
export type GameWaveResult = GameWavePlan & {
  dryRun: boolean
  cap: number
  /** This Orca's free slots under the lead's total: a wave launches only here. */
  free: number
  hosts?: GameHostLoad[]
  launched: GameLaunchResult[]
  failed: { ticket: string; error: string }[]
}

export type SweepClose =
  | { via: 'release'; dispatchId: string; state: string; reason?: string; recovery?: string }
  | { via: 'close'; terminal: string }
  | { via: 'release' | 'close'; error: string }

export type GameSweepResult = {
  closed: boolean
  /** `history` says why a member's record was not written; it is freed anyway. */
  finished: (GameSweepEntry & { closed?: SweepClose | null; history?: string })[]
}

export type GamePushResult = {
  dryRun: boolean
  members: (GamePushEntry & { sent: boolean; refusedReason?: string; error?: string })[]
}

export function tableOf(rows: string[][]): string {
  const widths =
    rows[0]?.map((_, column) => Math.max(...rows.map((row) => row[column]?.length ?? 0))) ?? []
  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column] ?? 0))
        .join('  ')
        .trimEnd()
    )
    .join('\n')
}

const ticketLabel = (row: GameFleetRow): string => row.ticket ?? row.name

// Why apart from the restart (ORCA-754): these terminals are open, so "restarted" sent the lead to resume over a live agent.
function formatOpenTerminals(paused: GameFleet['paused']): string[] {
  const unsubmitted = paused.filter((one) => one.cause === 'unsubmitted')
  const silent = paused.filter((one) => one.cause === 'terminal-open')
  const rowOf = (one: GameFleet['paused'][number], state: boolean): string[] => [
    one.ticket,
    ...(state ? [one.lastState ?? '-'] : []),
    one.terminal ?? '-',
    one.branch ?? '-',
    one.agent ?? '-',
    one.account ?? '-',
    one.name ?? ''
  ]
  const head = ['TICKET', 'TERMINAL', 'BRANCH', 'AGENT', 'ACCOUNT', 'NAME']
  return [
    ...(unsubmitted.length === 0
      ? []
      : [
          `Brief sent, not submitted: ${unsubmitted.length} · \`orca game resume-members\` presses Enter in its terminal`,
          tableOf([head, ...unsubmitted.map((one) => rowOf(one, false))])
        ]),
    ...(silent.length === 0
      ? []
      : [
          `Not reporting, terminal still open: ${silent.length} · check the terminal; \`orca game resume-members --discard\` stops and frees them`,
          tableOf([['TICKET', 'STATE', ...head.slice(1)], ...silent.map((one) => rowOf(one, true))])
        ])
  ]
}

const formatWorktreeGone = (gone: GameFleet['paused']): string[] =>
  gone.length === 0
    ? []
    : [
        `Cannot resume, worktree gone: ${gone.length} · \`orca game resume-members <ticket> --discard\` frees them`,
        tableOf([
          ['TICKET', 'STATE', 'BRANCH', 'AGENT', 'ACCOUNT', 'NAME'],
          ...gone.map((one) => [
            one.ticket,
            one.lastState ?? '-',
            one.branch ?? '-',
            one.agent ?? '-',
            one.account ?? '-',
            one.name ?? ''
          ])
        ])
      ]

function formatPaused(fleet: GameFleet): string[] {
  if (fleet.pausedError) {
    return [`Could not resume members: ${fleet.pausedError}`]
  }
  const restarted = fleet.paused.filter((one) => one.cause === undefined && !one.worktreeGone)
  const gone = fleet.paused.filter((one) => one.cause === undefined && one.worktreeGone)
  const open = [...formatOpenTerminals(fleet.paused), ...formatWorktreeGone(gone)]
  if (restarted.length === 0) {
    return open
  }
  const rows = restarted.map((one) => [
    one.ticket,
    one.lastState ?? '-',
    one.branch ?? '-',
    one.agent ?? '-',
    one.account ?? '-',
    one.resumable ? 'its conversation' : 'a new launch in its worktree',
    one.name ?? ''
  ])
  return [
    ...open,
    `Paused since Orca or the machine restarted: ${restarted.length} · \`orca game resume-members\` resumes them, \`--discard\` frees them`,
    tableOf([['TICKET', 'STATE', 'BRANCH', 'AGENT', 'ACCOUNT', 'RESUMES', 'NAME'], ...rows])
  ]
}

const formatQueued = (fleet: GameFleet): string[] =>
  fleet.queued.length === 0
    ? []
    : [
        `Queued behind a setup: ${fleet.queued.length} · each starts by itself`,
        ...fleet.queued.map((one) => `${one.ticket}: ${formatSetupQueue(one)}`)
      ]

function sinceOf(at: string | null, now: number): string {
  const ms = at ? now - Date.parse(at) : Number.NaN
  if (!Number.isFinite(ms)) {
    return '-'
  }
  const minutes = Math.max(0, Math.round(ms / 60_000))
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`
}

export type GameFleetWithBudget = GameFleet & {
  githubBudget?: GameGitHubBudget
  hostCapacity?: GameHostCapacity[]
}

export function formatFleet(fleet: GameFleetWithBudget, now: number = Date.now()): string {
  const { counts } = fleet
  const head = `Members: ${fleet.rows.length} (needs you ${counts['needs-you']}, limited ${counts.limited}, working ${counts.working}, idle ${counts.idle}, finished ${counts.finished}) · ${fleet.running}/${fleet.cap} running, ${fleet.free} free`
  const hosts = fleet.hostCapacity
    ? formatGameHostCapacity(fleet.hostCapacity)
    : fleet.hosts
      ? [`Hosts: ${gameHostLoadLineOf(fleet.hosts)}`]
      : []
  const budget = fleet.githubBudget ? formatGameGitHubBudget(fleet.githubBudget, now) : []
  const top = [head, ...hosts, ...budget]
  const paused = [...formatQueued(fleet), ...formatPaused(fleet)]
  if (fleet.rows.length === 0) {
    return [...top, ...paused].join('\n')
  }
  const rows = fleet.rows.map((row) => [
    row.phase,
    row.ticket ?? '-',
    row.ticketStatus ?? '-',
    row.stateKnown ? row.state : 'unknown',
    sinceOf(row.lastActivityAt, now),
    row.review ?? '-',
    row.ci ?? '-',
    row.branch ?? '-',
    row.host ?? 'local',
    row.agent ?? '-',
    row.account ?? (row.globalLogin ? GAME_GLOBAL_LOGIN_LABEL : '-'),
    row.next,
    row.name
  ])
  const header = [
    'PHASE',
    'TICKET',
    'STATUS',
    'STATE',
    'ACTIVE',
    'PR',
    'CI',
    'BRANCH',
    'HOST',
    'AGENT',
    'ACCOUNT'
  ]
  return [...top, tableOf([[...header, 'NEXT', 'NAME'], ...rows]), ...paused].join('\n')
}

export function formatWave(wave: GameWaveResult): string {
  const local = wave.hosts?.find((one) => one.host === LOCAL_GAME_HOST)
  const room = (wave.hosts ?? []).filter((one) => one.free > 0 && one.host !== LOCAL_GAME_HOST)
  const capped = wave.skipped.filter((one) => one.reason === 'cap')
  const lines = [
    local
      ? `Wave on this Orca: ${wave.free} of ${local.cap} slots free · Hosts: ${gameHostLoadLineOf(wave.hosts!)}`
      : `Wave: ${wave.free} of ${wave.cap} slots free`,
    wave.dryRun
      ? `Would launch: ${wave.launch.join(', ') || 'nothing'}`
      : wave.launched.map(formatGameLaunch).join('\n') || 'Launched nothing',
    ...wave.failed.map((one) => `Failed ${one.ticket}: ${one.error}`),
    ...wave.skipped.map((one) => `Skipped ${one.ticket}: ${one.reason}`),
    ...(capped.length > 0 && room.length > 0
      ? [
          `Room on ${room.map((one) => `${one.host} (${one.free} free)`).join(', ')}: \`game launch <ticket> --on ${room[0]!.host} --repo <selector>\``
        ]
      : [])
  ]
  return lines.join('\n')
}

function formatSweepClose(closed: SweepClose | null | undefined): string {
  if (!closed) {
    return closed === null ? ' — nothing to close' : ''
  }
  if ('error' in closed) {
    return ` — ${closed.via} failed: ${closed.error}`
  }
  return closed.via === 'close'
    ? ` — closed ${closed.terminal}`
    : ` — release ${closed.dispatchId} [${closed.state}]${closed.reason ? ` ${closed.reason}` : ''}`
}

export function formatSweep(sweep: GameSweepResult, now: number = Date.now()): string {
  if (sweep.finished.length === 0) {
    return 'No finished members.'
  }
  const lines = sweep.finished.map(
    (entry) =>
      `${ticketLabel(entry.row)} ${entry.row.review ?? ''} on ${entry.row.host ?? 'local'}, active ${sinceOf(entry.row.lastActivityAt, now)}${formatSweepClose(entry.closed)}\n  why: ${entry.reason}${entry.pending.length > 0 ? `\n  left: ${entry.pending.join('; ')}` : ''}${entry.history ? `\n  history ${entry.history}` : ''}`
  )
  return sweep.closed
    ? lines.join('\n')
    : `${lines.join('\n')}\nVerify each, then run with --close.`
}

export function formatPush(push: GamePushResult): string {
  if (push.members.length === 0) {
    return 'No members to push.'
  }
  return push.members
    .map((entry) => {
      const label = ticketLabel(entry.row)
      if (entry.action !== 'push') {
        return `${label} ${entry.action === 'needs-you' ? 'needs you' : 'left'}: ${entry.reason}`
      }
      const outcome = entry.sent
        ? 'sent'
        : push.dryRun
          ? 'would send'
          : `not sent (${entry.refusedReason ?? entry.error ?? 'refused'})`
      return `${label} push ${outcome}: ${entry.prompt ?? ''}`
    })
    .join('\n')
}

export type GameHeldStopResult = GameStopResult & { hold: GameHold; told: string[] }

export function formatHeldStop(result: GameHeldStopResult): string {
  const { hold } = result
  const head = hold.set
    ? `STOP set${hold.stopped?.since ? ` since ${hold.stopped.since}` : ''}: launches, waves, pushes and moves are refused until \`orca game resume\`.`
    : `STOP not set (${hold.reason ?? 'unknown'}); members were stopped anyway.`
  return [
    head,
    formatStop(result),
    ...(result.told.length > 0 ? [`Told to stop by message: ${result.told.join(', ')}`] : [])
  ].join('\n')
}
