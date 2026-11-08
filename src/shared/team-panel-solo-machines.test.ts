import { describe, expect, it } from 'vitest'
import type { GameHostMachine } from './orchestrator-game-host-capacity'
import type { TeamHost } from './team-panel-model-types'
import { teamSoloMachineHostsOf, teamSoloMachinesOf } from './team-panel-solo-machines'

const GB = 1024 ** 3
const machine = (availableMemory = 8 * GB): GameHostMachine => ({
  cpuCoreCount: 8,
  totalMemory: 16 * GB,
  availableMemory,
  loadAverage1m: 1.5
})
const paired = (name: string, environmentId: string): TeamHost => ({
  kind: 'remote',
  name,
  environmentId,
  reachable: true
})
const ssh = (name: string, reachable = true): TeamHost => ({
  kind: 'remote',
  name,
  environmentId: null,
  reachable
})
const local: TeamHost = { kind: 'local' }

describe('teamSoloMachineHostsOf', () => {
  it('lists this machine first, then every saved host, then each SSH target with a session', () => {
    const hosts = teamSoloMachineHostsOf({
      sessions: [{ host: ssh('box') }, { host: paired('mini', 'env-1') }, { host: local }],
      environments: [
        { id: 'env-1', name: 'mini' },
        { id: 'env-2', name: 'imac' }
      ]
    })

    expect(hosts).toEqual([local, paired('mini', 'env-1'), paired('imac', 'env-2'), ssh('box')])
  })

  it('lists an SSH target once, however many sessions it holds', () => {
    const hosts = teamSoloMachineHostsOf({
      sessions: [{ host: ssh('box') }, { host: ssh('box') }],
      environments: []
    })

    expect(hosts).toEqual([local, ssh('box')])
  })
})

describe('teamSoloMachinesOf', () => {
  const readingOf = (host: TeamHost) =>
    host.kind === 'local' ? { kind: 'ok' as const, machine: machine() } : null

  it('counts each host own sessions', () => {
    const [mine, mini] = teamSoloMachinesOf({
      hosts: [local, paired('mini', 'env-1')],
      sessions: [{ host: local }, { host: local }, { host: paired('mini', 'env-1') }],
      readingOf: () => ({ kind: 'ok', machine: machine() })
    })

    expect(mine.running).toBe(2)
    expect(mini.running).toBe(1)
    expect(mine.cap).toBeNull()
  })

  it('reads a host with no agents as idle and one with agents as working', () => {
    const [idle, busy] = teamSoloMachinesOf({
      hosts: [paired('mini', 'env-1'), local],
      sessions: [{ host: local }],
      readingOf: () => ({ kind: 'ok', machine: machine() })
    })

    expect(idle.status).toBe('idle')
    expect(busy.status).toBe('working')
    expect(busy.reading).toEqual({ kind: 'ok', ...machine() })
  })

  it('flags a host low on memory', () => {
    const [low] = teamSoloMachinesOf({
      hosts: [local],
      sessions: [],
      readingOf: () => ({ kind: 'ok', machine: machine(GB) })
    })

    expect(low.status).toBe('risk')
  })

  it('reads a paired host that did not answer as offline', () => {
    const [mini] = teamSoloMachinesOf({
      hosts: [paired('mini', 'env-1')],
      sessions: [],
      readingOf: () => ({ kind: 'unreachable' })
    })

    expect(mini.status).toBe('attention')
    expect(mini.reading).toEqual({ kind: 'unreachable', lastSeenAt: null })
  })

  it('never calls a connected SSH target offline: it has no Orca to read', () => {
    const [box] = teamSoloMachinesOf({
      hosts: [ssh('box')],
      sessions: [{ host: ssh('box') }],
      readingOf
    })

    expect(box.status).toBe('working')
    expect(box.reading).toEqual({ kind: 'unread' })
  })

  it('calls a disconnected SSH target offline', () => {
    const [box] = teamSoloMachinesOf({
      hosts: [ssh('box', false)],
      sessions: [{ host: ssh('box', false) }],
      readingOf
    })

    expect(box.status).toBe('attention')
    expect(box.reading).toEqual({ kind: 'unreachable', lastSeenAt: null })
  })

  it('shows a host still being read as a row without a reading, not as offline', () => {
    const [mini] = teamSoloMachinesOf({
      hosts: [paired('mini', 'env-1')],
      sessions: [],
      readingOf: () => null
    })

    expect(mini.reading).toEqual({ kind: 'unread' })
    expect(mini.status).toBe('idle')
  })
})
