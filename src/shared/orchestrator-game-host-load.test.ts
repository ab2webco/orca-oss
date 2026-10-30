import { describe, expect, it } from 'vitest'

import {
  gameHostCapsOf,
  gameHostLoadLineOf,
  gameHostLoadsOf,
  gameHostRefusalOf,
  gameLeadCapOverHostsOf,
  pairedGameHostOf,
  type GameHostCap
} from './orchestrator-game-host-load'

const GB = 1024 ** 3

describe('pairedGameHostOf', () => {
  it('reads the profile and cap a host publishes on status.get', () => {
    expect(pairedGameHostOf({ totalMemory: 32 * GB, cpuCoreCount: 10, memberCap: 5 })).toEqual({
      totalMemory: 32 * GB,
      cpuCoreCount: 10,
      memberCap: 5
    })
  })

  it('treats a host that publishes nothing, or something malformed, as an older host', () => {
    expect(pairedGameHostOf(undefined)).toBeNull()
    expect(pairedGameHostOf({ totalMemory: 'lots', cpuCoreCount: 8 })).toBeNull()
    expect(pairedGameHostOf({ totalMemory: -1, cpuCoreCount: 8 })).toBeNull()
  })

  it('drops a published cap outside one machine’s range and keeps the profile', () => {
    expect(pairedGameHostOf({ totalMemory: 16 * GB, cpuCoreCount: 8, memberCap: 40 })).toEqual({
      totalMemory: 16 * GB,
      cpuCoreCount: 8
    })
  })
})

describe('gameHostCapsOf', () => {
  it('gives each host its own cap: published, else what its memory and cores fit', () => {
    expect(
      gameHostCapsOf({ totalMemory: 20 * GB, cpuCoreCount: 10 }, [
        {
          name: 'imac',
          id: 'env-imac',
          reading: { kind: 'host', host: { totalMemory: 64 * GB, cpuCoreCount: 16, memberCap: 8 } }
        },
        {
          name: 'm1',
          id: 'env-m1',
          reading: { kind: 'host', host: { totalMemory: 24 * GB, cpuCoreCount: 8 } }
        }
      ])
    ).toEqual([
      { host: 'local', cap: 5, status: 'ok' },
      { host: 'imac', id: 'env-imac', cap: 8, status: 'ok' },
      { host: 'm1', id: 'env-m1', cap: 4, status: 'ok' }
    ])
  })

  it('an unreachable host and an older host add no capacity', () => {
    expect(
      gameHostCapsOf({ totalMemory: 16 * GB, cpuCoreCount: 8 }, [
        { name: 'm1', id: 'env-m1', reading: { kind: 'unreachable' } },
        { name: 'old', id: 'env-old', reading: { kind: 'older' } }
      ])
    ).toEqual([
      { host: 'local', cap: 4, status: 'ok' },
      { host: 'm1', id: 'env-m1', cap: 0, status: 'unreachable' },
      { host: 'old', id: 'env-old', cap: 0, status: 'older' }
    ])
  })
})

const HOSTS: GameHostCap[] = [
  { host: 'local', cap: 5, status: 'ok' },
  { host: 'imac', id: 'env-imac', cap: 6, status: 'ok' },
  { host: 'm1', id: 'env-m1', cap: 6, status: 'ok' }
]

describe('gameLeadCapOverHostsOf', () => {
  it('sums the reachable hosts, past the old fixed 12', () => {
    expect(gameLeadCapOverHostsOf(HOSTS, null)).toBe(17)
    expect(
      gameLeadCapOverHostsOf(
        [
          ...HOSTS,
          { host: 'mini', cap: 12, status: 'ok' },
          { host: 'm2', cap: 0, status: 'unreachable' }
        ],
        null
      )
    ).toBe(29)
  })

  it('an explicit lead cap is an overall ceiling, never a floor', () => {
    expect(gameLeadCapOverHostsOf(HOSTS, 10)).toBe(10)
    expect(gameLeadCapOverHostsOf(HOSTS, 40)).toBe(17)
  })
})

describe('gameHostLoadsOf', () => {
  it('counts running members per host, local first', () => {
    expect(gameHostLoadsOf(HOSTS, ['local', 'local', 'local', 'imac', 'imac'])).toEqual([
      { host: 'local', cap: 5, status: 'ok', running: 3, free: 2 },
      { host: 'imac', id: 'env-imac', cap: 6, status: 'ok', running: 2, free: 4 },
      { host: 'm1', id: 'env-m1', cap: 6, status: 'ok', running: 0, free: 6 }
    ])
  })

  it('an older host’s members take local slots, as before per-host caps', () => {
    const loads = gameHostLoadsOf(
      [
        { host: 'local', cap: 4, status: 'ok' },
        { host: 'old', cap: 0, status: 'older' }
      ],
      ['local', 'old', 'old']
    )
    expect(loads).toEqual([
      { host: 'local', cap: 4, status: 'ok', running: 3, free: 1 },
      { host: 'old', cap: 0, status: 'older', running: 2, free: 0 }
    ])
  })

  it('a member on a host no longer paired lists that host as unreachable', () => {
    expect(gameHostLoadsOf([{ host: 'local', cap: 4, status: 'ok' }], ['gone-box'])).toEqual([
      { host: 'local', cap: 4, status: 'ok', running: 0, free: 4 },
      { host: 'gone-box', cap: 0, status: 'unreachable', running: 1, free: 0 }
    ])
  })
})

describe('gameHostLoadLineOf', () => {
  it('reads as local 3/5 · imac 4/8 · m1 0/6', () => {
    expect(
      gameHostLoadLineOf([
        { host: 'local', cap: 5, status: 'ok', running: 3, free: 2 },
        { host: 'imac', cap: 8, status: 'ok', running: 4, free: 4 },
        { host: 'm1', cap: 6, status: 'ok', running: 0, free: 6 }
      ])
    ).toBe('local 3/5 · imac 4/8 · m1 0/6')
  })

  it('names an unreachable and an older host instead of a cap', () => {
    expect(
      gameHostLoadLineOf([
        { host: 'local', cap: 4, status: 'ok', running: 2, free: 2 },
        { host: 'm1', cap: 0, status: 'unreachable', running: 1, free: 0 },
        { host: 'old', cap: 0, status: 'older', running: 1, free: 0 }
      ])
    ).toBe('local 2/4 · m1 1 running, not answering · old 1 running, on local’s cap (older Orca)')
  })
})

describe('gameHostRefusalOf', () => {
  const loads = gameHostLoadsOf(HOSTS, [
    ...Array(5).fill('local'),
    ...Array(6).fill('imac'),
    'm1',
    'm1'
  ])

  it('refuses per host and names where there is room', () => {
    expect(gameHostRefusalOf(loads, { cap: 17, running: 13 }, 'imac', 'ORCA-1')).toBe(
      'imac at cap 6/6, m1 has 4 free: launch ORCA-1 with --on m1, or close one on imac.'
    )
    expect(gameHostRefusalOf(loads, { cap: 17, running: 13 }, null, 'ORCA-1')).toBe(
      'local at cap 5/5, m1 has 4 free: launch ORCA-1 with --on m1, or close one on local.'
    )
  })

  it('matches --on by environment id as well as name', () => {
    expect(gameHostRefusalOf(loads, { cap: 17, running: 13 }, 'env-imac', 'ORCA-1')).toMatch(
      /^imac at cap 6\/6/
    )
  })

  it('lets a launch through on a host with room', () => {
    expect(gameHostRefusalOf(loads, { cap: 17, running: 13 }, 'm1', 'ORCA-1')).toBeNull()
  })

  it('refuses at the lead’s overall ceiling even with room on the host', () => {
    expect(gameHostRefusalOf(loads, { cap: 13, running: 13 }, 'm1', 'ORCA-1')).toBe(
      '13 of 13 members are running, the lead’s cap; close one before launching ORCA-1.'
    )
  })

  it('a launch on an older host takes a local slot', () => {
    const older = gameHostLoadsOf(
      [
        { host: 'local', cap: 2, status: 'ok' },
        { host: 'old', cap: 0, status: 'older' }
      ],
      ['local', 'old']
    )
    expect(gameHostRefusalOf(older, { cap: 2, running: 2 }, 'old', 'ORCA-1')).toMatch(
      /^2 of 2 members are running/
    )
    expect(gameHostRefusalOf(older, { cap: 3, running: 2 }, 'old', 'ORCA-1')).toBe(
      'local at cap 2/2: close one on local before launching ORCA-1.'
    )
  })

  it('leaves an unreachable or unknown host to the launch itself', () => {
    const down = gameHostLoadsOf(
      [
        { host: 'local', cap: 4, status: 'ok' },
        { host: 'm1', cap: 0, status: 'unreachable' }
      ],
      []
    )
    expect(gameHostRefusalOf(down, { cap: 4, running: 0 }, 'm1', 'ORCA-1')).toBeNull()
    expect(gameHostRefusalOf(down, { cap: 4, running: 0 }, 'nowhere', 'ORCA-1')).toBeNull()
  })
})
