import { gameFleetReportOf } from './orchestrator-game-fleet-verbs'
import { gameHostSplitOf, LOCAL_GAME_HOST, type GameHostLoad } from './orchestrator-game-host-load'
import { DEFAULT_GAME_LEAD } from './orchestrator-game-lead'
import type { GameHostLaunch } from './orchestrator-game-member-repo-scope'
import type { OrchestratorGameState } from './orchestrator-game-state'

/** The host fields of a `diagnostics.memory` snapshot, which every paired host answers. */
export type GameHostMachine = {
  cpuCoreCount: number
  totalMemory: number
  availableMemory: number
  /** Null where the host reports none. */
  loadAverage1m: number | null
  /** Absent from a host older than ORCA-1252 or one that cannot read it: unknown, never zero. */
  cpuUsagePercent?: number
  workspaceDiskTotal?: number
  workspaceDiskFree?: number
}

export type GameHostReading = { kind: 'ok'; machine: GameHostMachine } | { kind: 'unreachable' }

/**
 * One host as a lead's game state publishes it (ORCA-841); `cap` while it publishes one (ORCA-888).
 * `launch` on a paired host only, and absent from an older Orca's state (ORCA-1207).
 */
export type GameHostCapacity = {
  host: string
  running: number
  cap?: number
  /** Other projects' members within `running` (ORCA-1284). */
  others?: { repo: string; running: number }[]
  launch?: GameHostLaunch
} & (({ status: 'ok' } & GameHostMachine) | { status: 'unreachable' })

const GB = 1024 ** 3
// Why: one member's share in the default cap (orchestrator-game-lead.ts); under 10% free macOS compresses.
const LOW_MEMORY_BYTES = 4 * GB

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const isAtLeastZero = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

export function gameHostCpuAndDiskOf(
  fields: Record<string, unknown>
): Pick<GameHostMachine, 'cpuUsagePercent' | 'workspaceDiskTotal' | 'workspaceDiskFree'> {
  const { cpuUsagePercent, workspaceDiskTotal, workspaceDiskFree } = fields
  return {
    ...(isAtLeastZero(cpuUsagePercent) && cpuUsagePercent <= 100 ? { cpuUsagePercent } : {}),
    ...(isPositive(workspaceDiskTotal) && isAtLeastZero(workspaceDiskFree)
      ? { workspaceDiskTotal, workspaceDiskFree: Math.min(workspaceDiskFree, workspaceDiskTotal) }
      : {})
  }
}

export function gameHostMachineOf(raw: unknown): GameHostMachine | null {
  const fields = (raw ?? {}) as Record<string, unknown>
  const { cpuCoreCount, totalMemory, availableMemory, loadAverage1m } = fields
  if (!isPositive(cpuCoreCount) || !isPositive(totalMemory)) {
    return null
  }
  return {
    cpuCoreCount,
    totalMemory,
    availableMemory: isPositive(availableMemory) ? Math.min(availableMemory, totalMemory) : 0,
    // Why a zero is none: Windows' os.loadavg() is always zero, and a live Orca host never idles at 0.00.
    loadAverage1m: isPositive(loadAverage1m) ? loadAverage1m : null,
    ...gameHostCpuAndDiskOf(fields)
  }
}

type Readings = readonly { host: string; reading: GameHostReading }[]

/** Paired host name to whether this lead's members can start there. */
export type GameHostLaunches = ReadonlyMap<string, GameHostLaunch>

/** Each host's machine over its ORCA-888 load, so its count is the one `game launch` refuses on. */
export function gameHostCapacitiesOf(
  readings: Readings,
  loads: readonly GameHostLoad[],
  launches?: GameHostLaunches | null
): GameHostCapacity[] {
  const machines = new Map(readings.map((one) => [one.host, one.reading]))
  return loads.map(({ host, running, cap, status, others }): GameHostCapacity => {
    const reading = machines.get(host)
    const launch = host === LOCAL_GAME_HOST ? undefined : launches?.get(host)
    const base = {
      host,
      running,
      ...(status === 'ok' ? { cap } : {}),
      ...(others ? { others } : {}),
      ...(launch ? { launch } : {})
    }
    return reading?.kind === 'ok'
      ? { ...base, status: 'ok', ...reading.machine }
      : { ...base, status: 'unreachable' }
  })
}

/** A lead with per-host caps gets the rows; one with no saved host gets this machine as `localHost`. */
export function withGameHostCapacity(
  state: OrchestratorGameState,
  readings: Readings | null,
  launches?: GameHostLaunches | null
): OrchestratorGameState {
  if (state.role !== 'lead' || !readings) {
    return state
  }
  const loads = gameFleetReportOf(state).hosts
  if (loads) {
    return { ...state, hostCapacity: gameHostCapacitiesOf(readings, loads, launches) }
  }
  // Why only alone: a saved host whose cap could not be read is still another machine.
  if (readings.length !== 1) {
    return state
  }
  const cap = (state.lead ?? DEFAULT_GAME_LEAD).cap
  const alone = gameFleetReportOf({
    ...state,
    hosts: [{ host: LOCAL_GAME_HOST, cap, status: 'ok' }]
  })
  const local = alone.hosts?.filter((one) => one.host === LOCAL_GAME_HOST) ?? []
  const [localHost] = gameHostCapacitiesOf(readings, local)
  return localHost ? { ...state, localHost } : state
}

const gbOf = (bytes: number): string =>
  bytes < 10 * GB ? (bytes / GB).toFixed(1) : String(Math.round(bytes / GB))

export const gameHostMemoryIsLow = (one: GameHostMachine): boolean =>
  one.availableMemory < LOW_MEMORY_BYTES || one.availableMemory < one.totalMemory * 0.1

const flagsOf = (one: GameHostMachine): string[] => [
  ...(gameHostMemoryIsLow(one) ? ['low memory'] : []),
  ...(one.loadAverage1m !== null && one.loadAverage1m >= one.cpuCoreCount ? ['busy'] : [])
]

const LAUNCH_FLAGS: Record<GameHostLaunch['kind'], string | null> = {
  ready: null,
  unregistered: 'project not registered',
  refused: 'refused by repo scope',
  unanswered: 'repos not answering'
}

/** `game fleet` and `game state` text: one line per host under `Hosts:`. */
export function formatGameHostCapacity(hosts: readonly GameHostCapacity[]): string[] {
  const width = Math.max(...hosts.map((one) => one.host.length))
  return [
    'Hosts:',
    ...hosts.map((one) => {
      const figures =
        one.status === 'ok'
          ? [
              `${one.cpuCoreCount} cores`,
              `${gbOf(one.availableMemory)} of ${gbOf(one.totalMemory)} GB free`,
              ...(one.loadAverage1m === null ? [] : [`load ${one.loadAverage1m.toFixed(1)}`]),
              ...flagsOf(one)
            ]
          : ['not answering']
      const running = `${one.cap === undefined ? one.running : `${one.running}/${one.cap}`} running${gameHostSplitOf(one)}`
      const launch = one.launch ? LAUNCH_FLAGS[one.launch.kind] : null
      return `  ${one.host.padEnd(width)}  ${[running, ...figures, ...(launch ? [launch] : [])].join(' · ')}`
    })
  ]
}
