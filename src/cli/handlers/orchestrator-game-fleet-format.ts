import { formatGameLaunch, type GameLaunchResult } from './orchestrator-game-launch'
import type {
  GameFleet,
  GameFleetRow,
  GamePushEntry,
  GameSweepEntry,
  GameWavePlan
} from '../../shared/orchestrator-game-fleet-verbs'

/** Text output of `orca game fleet|wave|sweep|push`; `--json` prints the results as they are. */
export type GameWaveResult = GameWavePlan & {
  dryRun: boolean
  cap: number
  free: number
  launched: GameLaunchResult[]
  failed: { ticket: string; error: string }[]
}

export type SweepClose =
  | { via: 'release'; dispatchId: string; state: string; reason?: string; recovery?: string }
  | { via: 'close'; terminal: string }
  | { via: 'release' | 'close'; error: string }

export type GameSweepResult = {
  closed: boolean
  finished: (GameSweepEntry & { closed?: SweepClose | null })[]
}

export type GamePushResult = {
  dryRun: boolean
  members: (GamePushEntry & { sent: boolean; refusedReason?: string; error?: string })[]
}

function tableOf(rows: string[][]): string {
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

export function formatFleet(fleet: GameFleet): string {
  const { counts } = fleet
  const head = `Members: ${fleet.rows.length} (needs you ${counts['needs-you']}, working ${counts.working}, idle ${counts.idle}, finished ${counts.finished}) · ${fleet.running}/${fleet.cap} running, ${fleet.free} free`
  if (fleet.rows.length === 0) {
    return head
  }
  const rows = fleet.rows.map((row) => [
    row.phase,
    row.ticket ?? '-',
    row.ticketStatus ?? '-',
    row.state,
    row.review ?? '-',
    row.ci ?? '-',
    row.branch ?? '-',
    row.next,
    row.name
  ])
  return `${head}\n${tableOf([['PHASE', 'TICKET', 'STATUS', 'STATE', 'PR', 'CI', 'BRANCH', 'NEXT', 'NAME'], ...rows])}`
}

export function formatWave(wave: GameWaveResult): string {
  const lines = [
    `Wave: ${wave.free} of ${wave.cap} slots free`,
    wave.dryRun
      ? `Would launch: ${wave.launch.join(', ') || 'nothing'}`
      : wave.launched.map(formatGameLaunch).join('\n') || 'Launched nothing',
    ...wave.failed.map((one) => `Failed ${one.ticket}: ${one.error}`),
    ...wave.skipped.map((one) => `Skipped ${one.ticket}: ${one.reason}`)
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

export function formatSweep(sweep: GameSweepResult): string {
  if (sweep.finished.length === 0) {
    return 'No finished members.'
  }
  const lines = sweep.finished.map(
    (entry) =>
      `${ticketLabel(entry.row)} ${entry.row.review ?? ''}${formatSweepClose(entry.closed)}${entry.pending.length > 0 ? `\n  left: ${entry.pending.join('; ')}` : ''}`
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
