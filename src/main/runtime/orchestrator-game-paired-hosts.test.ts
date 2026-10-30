import { describe, expect, it, vi } from 'vitest'

import { gameLeadOverPairedHostsOf, GamePairedHostReader } from './orchestrator-game-paired-hosts'

const GB = 1024 ** 3

describe('GamePairedHostReader', () => {
  const hosts = [
    { id: 'env-imac', name: 'imac' },
    { id: 'env-m1', name: 'm1' },
    { id: 'env-old', name: 'old' }
  ]
  const statuses: Record<string, unknown> = {
    'env-imac': { gameHost: { totalMemory: 64 * GB, cpuCoreCount: 16, memberCap: 8 } },
    'env-old': { runtimeId: 'r' }
  }
  const statusOf = vi.fn(async (id: string) => {
    if (!(id in statuses)) {
      throw new Error('timeout')
    }
    return statuses[id]
  })

  it('reads what each host publishes; silence is unreachable, no profile is an older host', async () => {
    const reader = new GamePairedHostReader({ list: () => hosts, statusOf })

    expect(await reader.read()).toEqual([
      {
        name: 'imac',
        id: 'env-imac',
        reading: { kind: 'host', host: { totalMemory: 64 * GB, cpuCoreCount: 16, memberCap: 8 } }
      },
      { name: 'm1', id: 'env-m1', reading: { kind: 'unreachable' } },
      { name: 'old', id: 'env-old', reading: { kind: 'older' } }
    ])
  })

  it('dials each host once per window, and serves the last reading while it refreshes', async () => {
    let now = 0
    const calls = vi.fn(async () => statuses['env-imac'])
    const reader = new GamePairedHostReader({
      list: () => [hosts[0]!],
      statusOf: calls,
      now: () => now
    })

    await reader.read()
    await reader.read()
    expect(calls).toHaveBeenCalledTimes(1)

    now = 60_000
    let answer: (value: unknown) => void = () => {}
    calls.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    expect((await reader.read())[0]!.reading).toMatchObject({ kind: 'host' })
    await reader.read()
    expect(calls).toHaveBeenCalledTimes(2)

    answer({})
    await vi.waitFor(async () =>
      expect((await reader.read())[0]!.reading).toEqual({ kind: 'older' })
    )
  })
})

describe('gameLeadOverPairedHostsOf', () => {
  const local = { totalMemory: 20 * GB, cpuCoreCount: 10 }
  const paired = async () => [
    {
      name: 'imac',
      id: 'env-imac',
      reading: {
        kind: 'host' as const,
        host: { totalMemory: 64 * GB, cpuCoreCount: 16, memberCap: 8 }
      }
    },
    { name: 'm1', id: 'env-m1', reading: { kind: 'unreachable' as const } }
  ]

  it('sums this Orca and each reachable host; an unreachable one adds 0', async () => {
    const placed = await gameLeadOverPairedHostsOf({}, { host: local, readPairedHosts: paired })
    expect(placed.lead.cap).toBe(13)
    expect(placed.hosts).toEqual([
      { host: 'local', cap: 5, status: 'ok' },
      { host: 'imac', id: 'env-imac', cap: 8, status: 'ok' },
      { host: 'm1', id: 'env-m1', cap: 0, status: 'unreachable' }
    ])
  })

  it('the project cap bounds the total, never one host', async () => {
    const placed = await gameLeadOverPairedHostsOf(
      { project: { orchestrator: { cap: 10 } } },
      { host: local, readPairedHosts: paired }
    )
    expect(placed.lead.cap).toBe(10)
    expect(placed.hosts?.map((one) => one.cap)).toEqual([5, 8, 0])
  })

  it('with no paired host, or none readable, the cap is the one the layers resolve', async () => {
    const layers = { project: { orchestrator: { cap: 8 } } }
    for (const readPairedHosts of [
      async () => [],
      async () => {
        throw new Error('x')
      },
      undefined
    ]) {
      expect(await gameLeadOverPairedHostsOf(layers, { host: local, readPairedHosts })).toEqual({
        lead: expect.objectContaining({ cap: 8 })
      })
    }
  })
})
