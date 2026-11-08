import { gameFleetReportOf } from './orchestrator-game-fleet-verbs'
import { LOCAL_GAME_HOST, type GameHostLoad } from './orchestrator-game-host-load'
import { DEFAULT_GAME_LEAD } from './orchestrator-game-lead'
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

/** A lead with per-host caps gets the rows; one with no saved host gets this machine as `localHost`. */
export function withGameHostCapacity(
  state: OrchestratorGameState,
  readings: Readings | null
): OrchestratorGameState {
  if (state.role !== 'lead' || !readings) {
    return state
  }
  const loads = gameFleetReportOf(state).hosts
  if (loads) {
    return { ...state, hostCapacity: gameHostCapacitiesOf(readings, loads) }
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
