import { isFinishedMember } from './orchestrator-game-member-finished'
import type { GameAgent } from './orchestrator-game-state'
import {
  defaultGameMemberCapOf,
  GAME_HOST_CAP_MAX,
  type GameHostProfile
} from './orchestrator-game-lead'

/** This Orca's row in the per-host load; paired hosts go by their saved environment name. */
export const LOCAL_GAME_HOST = 'local'

/** `older`: the host publishes no profile, so its members take local slots as before ORCA-888. */
export type GameHostCapStatus = 'ok' | 'unreachable' | 'older'

/** One host's member cap, as the lead's state publishes it (ORCA-888). */
export type GameHostCap = {
  host: string
  /** The saved environment's id, so `--on <id>` finds it too; absent for local. */
  id?: string
  cap: number
  status: GameHostCapStatus
}

export type GameHostLoad = GameHostCap & { running: number; free: number }

/** What a host publishes on `status.get`; `memberCap` is its own per-machine cap. */
export type PairedGameHost = GameHostProfile & { memberCap?: number }

export type PairedGameHostReading =
  | { kind: 'host'; host: PairedGameHost }
  | { kind: 'older' }
  | { kind: 'unreachable' }

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** A host's published `gameHost`, or null when it sends none or a malformed one. */
export function pairedGameHostOf(raw: unknown): PairedGameHost | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const { totalMemory, cpuCoreCount, memberCap } = raw as Record<string, unknown>
  if (!isCount(totalMemory) || !isCount(cpuCoreCount)) {
    return null
  }
  const capOk = Number.isInteger(memberCap) && isCount(memberCap) && memberCap <= GAME_HOST_CAP_MAX
  return { totalMemory, cpuCoreCount, ...(capOk ? { memberCap: memberCap as number } : {}) }
}

export function gameHostCapsOf(
  local: GameHostProfile | null,
  paired: readonly { name: string; id: string; reading: PairedGameHostReading }[]
): GameHostCap[] {
  return [
    { host: LOCAL_GAME_HOST, cap: defaultGameMemberCapOf(local), status: 'ok' },
    ...paired.map(({ name, id, reading }): GameHostCap => {
      if (reading.kind !== 'host') {
        return { host: name, id, cap: 0, status: reading.kind }
      }
      return {
        host: name,
        id,
        cap: reading.host.memberCap ?? defaultGameMemberCapOf(reading.host),
        status: 'ok'
      }
    })
  ]
}

/** Members the lead runs at once: every reachable host's cap, under the project's cap when set. */
export function gameLeadCapOverHostsOf(
  hosts: readonly GameHostCap[],
  ceiling: number | null
): number {
  const sum = hosts.reduce((total, one) => total + (one.status === 'ok' ? one.cap : 0), 0)
  return ceiling === null ? sum : Math.min(sum, ceiling)
}

/** `runningOn` names each running member's host; an older host's members count on local too. */
export function gameHostLoadsOf(
  hosts: readonly GameHostCap[],
  runningOn: readonly string[]
): GameHostLoad[] {
  const known = new Set(hosts.map((one) => one.host))
  const all: GameHostCap[] = [
    ...hosts,
    ...[...new Set(runningOn.filter((host) => !known.has(host)))].map(
      (host): GameHostCap => ({ host, cap: 0, status: 'unreachable' })
    )
  ]
  const older = new Set(all.filter((one) => one.status === 'older').map((one) => one.host))
  const onOlder = runningOn.filter((host) => older.has(host)).length
  return all.map((one) => {
    const running =
      runningOn.filter((host) => host === one.host).length +
      (one.host === LOCAL_GAME_HOST ? onOlder : 0)
    return { ...one, running, free: one.status === 'ok' ? Math.max(0, one.cap - running) : 0 }
  })
}

export function gameHostLoadLineOf(loads: readonly GameHostLoad[]): string {
  return loads
    .map((one) =>
      one.status === 'ok'
        ? `${one.host} ${one.running}/${one.cap}`
        : one.status === 'unreachable'
          ? `${one.host} ${one.running} running, not answering`
          : `${one.host} ${one.running} running, on local’s cap (older Orca)`
    )
    .join(' · ')
}

/** The host `--on` names, by name or environment id; local without one. */
export function gameHostLoadFor(
  loads: readonly GameHostLoad[],
  on: string | null
): GameHostLoad | undefined {
  const target = on ?? LOCAL_GAME_HOST
  return loads.find((one) => one.host === target || one.id === target)
}

/** Why a launch on `on` (local when null) cannot start, or null when it may. */
export function gameHostRefusalOf(
  loads: readonly GameHostLoad[],
  total: { cap: number; running: number },
  on: string | null,
  ticket: string
): string | null {
  if (total.running >= total.cap) {
    return `${total.running} of ${total.cap} members are running, the lead’s cap; close one before launching ${ticket}.`
  }
  const named = gameHostLoadFor(loads, on)
  // Why: a stale reading must not block a host that answers again; the launch itself reports one that does not.
  if (named === undefined || named.status === 'unreachable') {
    return null
  }
  const target = named.status === 'older' ? gameHostLoadFor(loads, null) : named
  if (target === undefined || target.free > 0) {
    return null
  }
  const room = loads.filter((one) => one.free > 0 && one.host !== target.host)
  const at = `${target.host} at cap ${target.running}/${target.cap}`
  if (room.length === 0) {
    return `${at}: close one on ${target.host} before launching ${ticket}.`
  }
  const where = room.map((one) => `${one.host} has ${one.free} free`).join(', ')
  return `${at}, ${where}: launch ${ticket} with --on ${room[0]!.host}, or close one on ${target.host}.`
}

// Why paused and queued ones are local: a remote member is never saved or queued here (ORCA-864).
export function gameFleetHostLoadsOf(
  hosts: readonly GameHostCap[],
  members: readonly GameAgent[],
  localHeld: number
): GameHostLoad[] {
  const runningOn = members
    .filter((agent) => !isFinishedMember(agent) && !agent.remote?.gone)
    .map((agent) => agent.remote?.host ?? LOCAL_GAME_HOST)
  return gameHostLoadsOf(hosts, [...runningOn, ...Array<string>(localHeld).fill(LOCAL_GAME_HOST)])
}

/** Slots a launch on this Orca may take: its own free ones, never past the lead's total. */
export function localGameFreeOf(fleet: { free: number; hosts?: readonly GameHostLoad[] }): number {
  const local = fleet.hosts && gameHostLoadFor(fleet.hosts, null)
  return local ? Math.min(local.free, fleet.free) : fleet.free
}
