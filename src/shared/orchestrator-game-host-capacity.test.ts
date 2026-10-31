import { describe, expect, it } from 'vitest'
import {
  formatGameHostCapacity,
  gameHostCapacitiesOf,
  gameHostMachineOf,
  withGameHostCapacity
} from './orchestrator-game-host-capacity'
import type { GameAgent, OrchestratorGameState } from './orchestrator-game-state'

const GB = 1024 ** 3

const member = (paneKey: string, extra: Partial<GameAgent> = {}): GameAgent => ({
  paneKey,
  displayName: paneKey,
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  ...extra
})

const onImac = (stateKnown = true, gone = false): GameAgent['remote'] => ({
  host: 'imac',
  stateKnown,
  ...(gone ? { gone: true as const } : {})
})

const imac = {
  cpuCoreCount: 4,
  totalMemory: 52 * GB,
  availableMemory: 4.9 * GB,
  loadAverage1m: 3.8
}
const local = {
  cpuCoreCount: 10,
  totalMemory: 16 * GB,
  availableMemory: 9 * GB,
  loadAverage1m: 2.1
}

describe('gameHostMachineOf', () => {
  it('reads the host fields diagnostics.memory carries', () => {
    expect(gameHostMachineOf({ ...imac, freeMemory: 1, usedMemory: 2 })).toEqual(imac)
  })

  it('refuses a reading without cores or memory', () => {
    expect(gameHostMachineOf(null)).toBeNull()
    expect(gameHostMachineOf({ ...imac, cpuCoreCount: 0 })).toBeNull()
    expect(gameHostMachineOf({ ...imac, totalMemory: 'lots' })).toBeNull()
  })

  it('reads a zero load as none, since Windows always reports zero', () => {
    expect(gameHostMachineOf({ ...imac, loadAverage1m: 0 })?.loadAverage1m).toBeNull()
  })

  it('never reports more free memory than the machine has', () => {
    expect(gameHostMachineOf({ ...imac, availableMemory: 99 * GB })?.availableMemory).toBe(52 * GB)
  })
})

describe('gameHostCapacitiesOf', () => {
  it('lays each host’s machine over its ORCA-888 load, with a cap only where one is published', () => {
    const rows = gameHostCapacitiesOf(
      [
        { host: 'local', reading: { kind: 'ok', machine: local } },
        { host: 'imac', reading: { kind: 'ok', machine: imac } },
        { host: 'm1', reading: { kind: 'unreachable' } },
        { host: 'mini', reading: { kind: 'ok', machine: imac } }
      ],
      [
        { host: 'local', cap: 4, status: 'ok', running: 3, free: 1 },
        { host: 'imac', id: 'env_imac', cap: 6, status: 'ok', running: 2, free: 4 },
        { host: 'm1', id: 'env_m1', cap: 0, status: 'unreachable', running: 0, free: 0 },
        { host: 'mini', id: 'env_mini', cap: 0, status: 'older', running: 1, free: 0 },
        // A member's host with no saved environment, which the reader never dialed.
        { host: 'gone', cap: 0, status: 'unreachable', running: 1, free: 0 }
      ]
    )
    expect(rows).toEqual([
      { host: 'local', running: 3, cap: 4, status: 'ok', ...local },
      { host: 'imac', running: 2, cap: 6, status: 'ok', ...imac },
      { host: 'm1', running: 0, status: 'unreachable' },
      { host: 'mini', running: 1, status: 'ok', ...imac },
      { host: 'gone', running: 1, status: 'unreachable' }
    ])
  })
})

describe('withGameHostCapacity', () => {
  const state = {
    role: 'lead',
    agents: [
      member('a'),
      member('b', { remote: onImac() }),
      member('c', { remote: onImac(true, true) })
    ],
    lead: { autostart: false, cap: 10, agent: 'claude' },
    hosts: [
      { host: 'local', cap: 4, status: 'ok' },
      { host: 'imac', id: 'env_imac', cap: 6, status: 'ok' }
    ],
    pausedMembers: [{ worktreeGone: false }]
  } as unknown as OrchestratorGameState
  const readings = [
    { host: 'local', reading: { kind: 'ok' as const, machine: local } },
    { host: 'imac', reading: { kind: 'ok' as const, machine: imac } }
  ]

  it('counts a lead’s members per host as game launch does: paused on local, gone nowhere', () => {
    expect(
      withGameHostCapacity(state, readings).hostCapacity?.map((one) => [
        one.host,
        one.running,
        one.cap
      ])
    ).toEqual([
      ['local', 2, 4],
      ['imac', 1, 6]
    ])
  })

  it('leaves a member, and a lead without per-host caps or readings, as they were', () => {
    const asMember = { ...state, role: 'member' as const }
    const unplaced = { ...state, hosts: undefined }
    expect(withGameHostCapacity(asMember, readings)).toBe(asMember)
    expect(withGameHostCapacity(state, null)).toBe(state)
    expect(withGameHostCapacity(unplaced, readings)).toBe(unplaced)
  })
})

describe('formatGameHostCapacity', () => {
  it('prints one line per host with its cap, cores, free memory and load', () => {
    expect(
      formatGameHostCapacity([
        { host: 'local', running: 3, cap: 4, status: 'ok', ...local },
        { host: 'imac', running: 2, status: 'ok', ...imac },
        { host: 'm1', running: 0, cap: 6, status: 'unreachable' }
      ])
    ).toEqual([
      'Hosts:',
      '  local  3/4 running · 10 cores · 9.0 of 16 GB free · load 2.1',
      '  imac   2 running · 4 cores · 4.9 of 52 GB free · load 3.8 · low memory',
      '  m1     0/6 running · not answering'
    ])
  })

  it('says a host is busy when its load reaches its cores, and leaves out a load it lacks', () => {
    expect(
      formatGameHostCapacity([
        { host: 'win', running: 1, status: 'ok', ...local, loadAverage1m: null },
        {
          host: 'mini',
          running: 4,
          status: 'ok',
          ...imac,
          availableMemory: 20 * GB,
          loadAverage1m: 6
        }
      ]).slice(1)
    ).toEqual([
      '  win   1 running · 10 cores · 9.0 of 16 GB free',
      '  mini  4 running · 4 cores · 20 of 52 GB free · load 6.0 · busy'
    ])
  })
})
