import { gameHostMemoryIsLow } from './orchestrator-game-host-capacity'
import type { TeamHost, TeamMachine, TeamMemberCard } from './team-panel-model-types'

const GB = 1024 ** 3
const BUSY_PERCENT = 90
// Why 10 GB: a fresh worktree with its dependencies can take several.
const LOW_DISK_BYTES = 10 * GB

export type TeamMachineWarning = 'busy' | 'lowMemory' | 'lowDisk'

/** Percent in use; null is a figure the host did not send (an older Orca), never 0. */
export type TeamMachineGauges = { cpu: number | null; memory: number; disk: number | null }

const percentOf = (used: number, total: number): number =>
  Math.min(100, Math.max(0, Math.round((used / total) * 100)))

export function teamMachineGaugesOf(machine: TeamMachine): TeamMachineGauges | null {
  const { reading } = machine
  if (reading.kind !== 'ok') {
    return null
  }
  const { workspaceDiskTotal: total, workspaceDiskFree: free } = reading
  return {
    cpu: reading.cpuUsagePercent ?? null,
    memory: percentOf(reading.totalMemory - reading.availableMemory, reading.totalMemory),
    disk: total === undefined || free === undefined ? null : percentOf(total - free, total)
  }
}

/** Busy by CPU use or by a load over its cores (as `game hosts` says), low memory, low disk. */
export function teamMachineWarningsOf(machine: TeamMachine): TeamMachineWarning[] {
  const { reading } = machine
  if (reading.kind !== 'ok') {
    return []
  }
  const { cpuUsagePercent: cpu, loadAverage1m: load, workspaceDiskTotal: total } = reading
  const free = reading.workspaceDiskFree
  const warnings: TeamMachineWarning[] = []
  if (
    (cpu !== undefined && cpu >= BUSY_PERCENT) ||
    (load !== null && load >= reading.cpuCoreCount)
  ) {
    warnings.push('busy')
  }
  if (gameHostMemoryIsLow(reading)) {
    warnings.push('lowMemory')
  }
  if (total !== undefined && free !== undefined && (free < LOW_DISK_BYTES || free < total * 0.1)) {
    warnings.push('lowDisk')
  }
  return warnings
}

const sameHost = (a: TeamHost, b: TeamHost): boolean =>
  a.kind === 'local' ? b.kind === 'local' : b.kind === 'remote' && a.name === b.name

/** The tickets of the members running on that host, once each. */
export function teamMachineTicketsOf(
  machine: TeamMachine,
  members: readonly Pick<TeamMemberCard, 'host' | 'ticket'>[]
): string[] {
  const tickets = members
    .filter((one) => one.ticket && sameHost(one.host, machine.host))
    .map((one) => one.ticket!.identifier)
  return [...new Set(tickets)]
}
