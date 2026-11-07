import { gameHostMemoryIsLow, type GameHostReading } from './orchestrator-game-host-capacity'
import type { TeamHost, TeamMachine } from './team-panel-model-types'

type SessionOnHost = { host: TeamHost }

export const TEAM_LOCAL_HOST_KEY = ''

export const teamHostKeyOf = (host: TeamHost): string =>
  host.kind === 'local' ? TEAM_LOCAL_HOST_KEY : (host.environmentId ?? host.name)

/** This machine, every saved host (as a team's Machines lists them), then each SSH target in use. */
export function teamSoloMachineHostsOf(args: {
  sessions: readonly SessionOnHost[]
  environments: readonly { id: string; name: string }[]
}): TeamHost[] {
  const hosts = new Map<string, TeamHost>([[TEAM_LOCAL_HOST_KEY, { kind: 'local' }]])
  for (const { id, name } of args.environments) {
    hosts.set(id, { kind: 'remote', name, environmentId: id, reachable: true })
  }
  for (const { host } of args.sessions) {
    const key = teamHostKeyOf(host)
    if (!hosts.has(key)) {
      hosts.set(key, host)
    }
  }
  return [...hosts.values()]
}

/** `readingOf` is null for a host with no reading: an SSH target, or one still being read. */
export function teamSoloMachinesOf(args: {
  hosts: readonly TeamHost[]
  sessions: readonly SessionOnHost[]
  readingOf: (host: TeamHost) => GameHostReading | null
}): TeamMachine[] {
  return args.hosts.map((host) => {
    const key = teamHostKeyOf(host)
    const running = args.sessions.filter((one) => teamHostKeyOf(one.host) === key).length
    const base = { host, running, cap: null }
    const reading = args.readingOf(host)
    if (reading?.kind === 'unreachable' || (host.kind === 'remote' && !host.reachable)) {
      return { ...base, status: 'attention', reading: { kind: 'unreachable', lastSeenAt: null } }
    }
    const status = running > 0 ? 'working' : 'idle'
    if (!reading) {
      return { ...base, status, reading: { kind: 'unread' } }
    }
    return {
      ...base,
      status: gameHostMemoryIsLow(reading.machine) ? 'risk' : status,
      reading: { kind: 'ok', ...reading.machine }
    }
  })
}
