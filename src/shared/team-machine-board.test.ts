import { describe, expect, it } from 'vitest'
import type { TeamMachine, TeamMemberCard } from './team-panel-model-types'
import {
  teamMachineGaugesOf,
  teamMachinesSummaryOf,
  teamMachineTicketsOf,
  teamMachineWarningsOf
} from './team-machine-board'

const GB = 1024 ** 3

type Reading = Extract<TeamMachine['reading'], { kind: 'ok' }>

const reading = (over: Partial<Reading> = {}): Reading => ({
  kind: 'ok',
  cpuCoreCount: 8,
  totalMemory: 32 * GB,
  availableMemory: 24 * GB,
  loadAverage1m: 1,
  cpuUsagePercent: 42,
  workspaceDiskTotal: 500 * GB,
  workspaceDiskFree: 125 * GB,
  ...over
})

const machine = (name: string, over: Partial<TeamMachine> = {}): TeamMachine => ({
  host: { kind: 'remote', name, environmentId: null, reachable: true },
  running: 0,
  cap: 4,
  status: 'idle',
  launch: { kind: 'ready' },
  reading: reading(),
  ...over
})

const offline = (name: string): TeamMachine =>
  machine(name, { status: 'attention', reading: { kind: 'unreachable', lastSeenAt: null } })

describe('teamMachineGaugesOf', () => {
  it('reads the percent in use of CPU, memory and the workspaces disk', () => {
    expect(teamMachineGaugesOf(machine('studio'))).toEqual({ cpu: 42, memory: 25, disk: 75 })
  })

  // Why: an older Orca sends no CPU or disk; a 0 would say the host is idle and empty.
  it('leaves what an older host does not send unknown, never 0', () => {
    const older = reading()
    delete older.cpuUsagePercent
    delete older.workspaceDiskTotal
    delete older.workspaceDiskFree

    expect(teamMachineGaugesOf(machine('studio', { reading: older }))).toEqual({
      cpu: null,
      memory: 25,
      disk: null
    })
  })

  it('has no gauges for a host with no reading', () => {
    expect(teamMachineGaugesOf(offline('studio'))).toBeNull()
    expect(teamMachineGaugesOf(machine('studio', { reading: { kind: 'unread' } }))).toBeNull()
  })
})

describe('teamMachineWarningsOf', () => {
  it('says nothing about a calm host', () => {
    expect(teamMachineWarningsOf(machine('studio'))).toEqual([])
  })

  it('calls a host busy by its CPU use or by a load over its cores', () => {
    expect(
      teamMachineWarningsOf(machine('a', { reading: reading({ cpuUsagePercent: 93 }) }))
    ).toEqual(['busy'])
    expect(teamMachineWarningsOf(machine('b', { reading: reading({ loadAverage1m: 9 }) }))).toEqual(
      ['busy']
    )
  })

  it('warns of low memory and a low workspaces disk', () => {
    const low = reading({ availableMemory: 1 * GB, workspaceDiskFree: 8 * GB })

    expect(teamMachineWarningsOf(machine('studio', { reading: low }))).toEqual([
      'lowMemory',
      'lowDisk'
    ])
  })

  it('never warns from a figure the host did not send', () => {
    const older = reading()
    delete older.cpuUsagePercent
    delete older.workspaceDiskFree

    expect(teamMachineWarningsOf(machine('studio', { reading: older }))).toEqual([])
    expect(teamMachineWarningsOf(offline('studio'))).toEqual([])
  })
})

describe('teamMachineTicketsOf', () => {
  const member = (host: TeamMemberCard['host'], identifier: string | null) =>
    ({
      host,
      ticket: identifier ? { identifier, title: null, url: null, statusGroup: null } : null
    }) as TeamMemberCard

  it('lists the tickets of the members running on that host, once each', () => {
    const studio = machine('studio')
    const members = [
      member(studio.host, 'LAB-12'),
      member({ kind: 'remote', name: 'other', environmentId: null, reachable: true }, 'LAB-13'),
      member(studio.host, 'LAB-12'),
      member(studio.host, null),
      member({ kind: 'local' }, 'LAB-14')
    ]

    expect(teamMachineTicketsOf(studio, members)).toEqual(['LAB-12'])
    expect(teamMachineTicketsOf(machine('x', { host: { kind: 'local' } }), members)).toEqual([
      'LAB-14'
    ])
  })
})

describe('teamMachinesSummaryOf', () => {
  // Why free on ready hosts only: a slot on a refused or offline host takes no member.
  it('counts the hosts ready to launch, the agents against the answering caps, and the warned hosts', () => {
    const busy = machine('busy', {
      running: 2,
      reading: reading({ cpuUsagePercent: 97 })
    })
    const summary = teamMachinesSummaryOf([
      machine('studio', { running: 3 }),
      busy,
      machine('blocked', { launch: { kind: 'refused', reason: 'no' } }),
      machine('bare', { cap: null, running: 1 }),
      offline('away')
    ])

    expect(summary).toEqual({
      hosts: 5,
      ready: 3,
      blocked: 1,
      offline: 1,
      running: 6,
      cap: 12,
      free: 3,
      warned: [busy]
    })
  })

  it('has no cap when no host publishes one', () => {
    expect(teamMachinesSummaryOf([machine('studio', { cap: null, running: 2 })])).toMatchObject({
      running: 2,
      cap: null,
      free: null
    })
  })
})
