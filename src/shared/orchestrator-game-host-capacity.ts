import { gameFleetReportOf } from './orchestrator-game-fleet-verbs'
import type { GameHostLoad } from './orchestrator-game-host-load'
import type { OrchestratorGameState } from './orchestrator-game-state'

/** The host fields of a `diagnostics.memory` snapshot, which every paired host answers. */
export type GameHostMachine = {
  cpuCoreCount: number
  totalMemory: number
  availableMemory: number
  /** Null where the host reports none. */
  loadAverage1m: number | null
}

export type GameHostReading = { kind: 'ok'; machine: GameHostMachine } | { kind: 'unreachable' }

/** One host as a lead's game state publishes it (ORCA-841); `cap` while it publishes one (ORCA-888). */
export type GameHostCapacity = { host: string; running: number; cap?: number } & (
  | ({ status: 'ok' } & GameHostMachine)
  | { status: 'unreachable' }
)

const GB = 1024 ** 3
// Why: one member's share in the default cap (orchestrator-game-lead.ts); under 10% free macOS compresses.
const LOW_MEMORY_BYTES = 4 * GB

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

export function gameHostMachineOf(raw: unknown): GameHostMachine | null {
  const { cpuCoreCount, totalMemory, availableMemory, loadAverage1m } = (raw ?? {}) as Record<
    string,
    unknown
  >
  if (!isPositive(cpuCoreCount) || !isPositive(totalMemory)) {
    return null
  }
  return {
    cpuCoreCount,
    totalMemory,
    availableMemory: isPositive(availableMemory) ? Math.min(availableMemory, totalMemory) : 0,
    // Why a zero is none: Windows' os.loadavg() is always zero, and a live Orca host never idles at 0.00.
    loadAverage1m: isPositive(loadAverage1m) ? loadAverage1m : null
  }
}

type Readings = readonly { host: string; reading: GameHostReading }[]

/** Each host's machine over its ORCA-888 load, so its count is the one `game launch` refuses on. */
export function gameHostCapacitiesOf(
  readings: Readings,
  loads: readonly GameHostLoad[]
): GameHostCapacity[] {
  const machines = new Map(readings.map((one) => [one.host, one.reading]))
  return loads.map(({ host, running, cap, status }): GameHostCapacity => {
    const reading = machines.get(host)
    const capped = status === 'ok' ? { cap } : {}
    return reading?.kind === 'ok'
      ? { host, running, ...capped, status: 'ok', ...reading.machine }
      : { host, running, ...capped, status: 'unreachable' }
  })
}

/** Only a lead with per-host caps gets the rows; null readings mean no environment is saved. */
export function withGameHostCapacity(
  state: OrchestratorGameState,
  readings: Readings | null
): OrchestratorGameState {
  const loads = state.role === 'lead' && readings ? gameFleetReportOf(state).hosts : undefined
  return loads ? { ...state, hostCapacity: gameHostCapacitiesOf(readings!, loads) } : state
}

const gbOf = (bytes: number): string =>
  bytes < 10 * GB ? (bytes / GB).toFixed(1) : String(Math.round(bytes / GB))

const flagsOf = (one: GameHostMachine): string[] => [
  ...(one.availableMemory < LOW_MEMORY_BYTES || one.availableMemory < one.totalMemory * 0.1
    ? ['low memory']
    : []),
  ...(one.loadAverage1m !== null && one.loadAverage1m >= one.cpuCoreCount ? ['busy'] : [])
]

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
      const running = one.cap === undefined ? one.running : `${one.running}/${one.cap}`
      return `  ${one.host.padEnd(width)}  ${[`${running} running`, ...figures].join(' · ')}`
    })
  ]
}
