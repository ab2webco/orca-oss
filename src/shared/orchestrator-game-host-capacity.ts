import { isFinishedMember } from './orchestrator-game-member-finished'
import type { GameAgent, OrchestratorGameState } from './orchestrator-game-state'

/** This Orca's row; a paired host goes by its saved environment name. */
export const LOCAL_GAME_HOST = 'local'

/** The host fields of a `diagnostics.memory` snapshot, which every paired host answers. */
export type GameHostMachine = {
  cpuCoreCount: number
  totalMemory: number
  availableMemory: number
  /** Null where the host reports none. */
  loadAverage1m: number | null
}

export type GameHostReading = { kind: 'ok'; machine: GameHostMachine } | { kind: 'unreachable' }

/** One host as a lead's game state publishes it (ORCA-841). */
export type GameHostCapacity = { host: string; running: number } & (
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

/** Counts members as `game fleet` does: paused and queued ones hold a slot here (ORCA-832, ORCA-864). */
export function gameHostCapacitiesOf(
  readings: Readings,
  fleet: Pick<OrchestratorGameState, 'agents' | 'pausedMembers' | 'queuedMembers'>
): GameHostCapacity[] {
  const runningOn = fleet.agents
    .filter((agent: GameAgent) => agent.isMember && !isFinishedMember(agent) && !agent.remote?.gone)
    .map((agent) => agent.remote?.host ?? LOCAL_GAME_HOST)
  const held =
    (fleet.pausedMembers ?? []).filter((one) => !one.worktreeGone).length +
    (fleet.queuedMembers ?? []).length
  const known = new Set(readings.map((one) => one.host))
  // Why: a member whose environment was removed still runs somewhere this Orca cannot read.
  const unsaved = [...new Set(runningOn)]
    .filter((host) => !known.has(host))
    .map((host) => ({ host, reading: { kind: 'unreachable' } as const }))
  const isLocal = (one: { host: string }) => one.host === LOCAL_GAME_HOST
  return [...readings.filter(isLocal), ...readings.filter((one) => !isLocal(one)), ...unsaved].map(
    ({ host, reading }): GameHostCapacity => {
      const running =
        runningOn.filter((one) => one === host).length + (isLocal({ host }) ? held : 0)
      return reading.kind === 'ok'
        ? { host, running, status: 'ok', ...reading.machine }
        : { host, running, status: 'unreachable' }
    }
  )
}

/** Only a lead with a paired host gets the rows; null readings mean none is saved. */
export const withGameHostCapacity = (
  state: OrchestratorGameState,
  readings: Readings | null
): OrchestratorGameState =>
  state.role !== 'lead' || readings === null
    ? state
    : { ...state, hostCapacity: gameHostCapacitiesOf(readings, state) }

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
      return `  ${one.host.padEnd(width)}  ${[`${one.running} running`, ...figures].join(' · ')}`
    })
  ]
}
