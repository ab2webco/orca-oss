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
  it('counts the members running on each host, local first', () => {
    const rows = gameHostCapacitiesOf(
      [
        { host: 'imac', reading: { kind: 'ok', machine: imac } },
        { host: 'local', reading: { kind: 'ok', machine: local } },
        { host: 'm1', reading: { kind: 'unreachable' } }
      ],
      {
        agents: [
          member('lead', { isLeader: true, isMember: false }),
          member('a'),
          member('b', { remote: onImac() }),
          member('c', { remote: onImac(false) }),
          // Gone from its host, so nothing runs there (ORCA-864).
          member('d', { remote: onImac(true, true) }),
          member('e', {
            state: 'idle',
            review: { provider: 'github', number: 1, state: 'merged', ci: 'success', url: '' }
          } as Partial<GameAgent>)
        ],
        pausedMembers: [{ worktreeGone: false }, { worktreeGone: true }] as never,
        queuedMembers: [{}] as never
      }
    )
    expect(rows).toEqual([
      { host: 'local', running: 3, status: 'ok', ...local },
      { host: 'imac', running: 2, status: 'ok', ...imac },
      { host: 'm1', running: 0, status: 'unreachable' }
    ])
  })

  it('lists a host its members name even when it is no longer saved', () => {
    const rows = gameHostCapacitiesOf(
      [{ host: 'local', reading: { kind: 'ok', machine: local } }],
      {
        agents: [member('b', { remote: onImac() })]
      }
    )
    expect(rows.map((one) => [one.host, one.running, one.status])).toEqual([
      ['local', 0, 'ok'],
      ['imac', 1, 'unreachable']
    ])
  })
})

describe('withGameHostCapacity', () => {
  const state = { role: 'lead', agents: [member('a')] } as OrchestratorGameState
  const readings = [{ host: 'local', reading: { kind: 'ok' as const, machine: local } }]

  it('publishes the rows for a lead', () => {
    expect(withGameHostCapacity(state, readings).hostCapacity?.[0]?.running).toBe(1)
  })

  it('leaves a member, and a lead with no paired host, as they were', () => {
    const asMember = { ...state, role: 'member' as const }
    expect(withGameHostCapacity(asMember, readings)).toBe(asMember)
    expect(withGameHostCapacity(state, null)).toBe(state)
  })
})

describe('formatGameHostCapacity', () => {
  it('prints one line per host with cores, free memory and load', () => {
    expect(
      formatGameHostCapacity([
        { host: 'local', running: 3, status: 'ok', ...local },
        { host: 'imac', running: 2, status: 'ok', ...imac },
        { host: 'm1', running: 0, status: 'unreachable' }
      ])
    ).toEqual([
      'Hosts:',
      '  local  3 running · 10 cores · 9.0 of 16 GB free · load 2.1',
      '  imac   2 running · 4 cores · 4.9 of 52 GB free · load 3.8 · low memory',
      '  m1     0 running · not answering'
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
