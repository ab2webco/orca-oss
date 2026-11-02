import { describe, expect, it, vi } from 'vitest'
import { GameHostCapacityReader } from './orchestrator-game-host-capacity-reader'

const GB = 1024 ** 3
const machine = (cores: number) => ({
  cpuCoreCount: cores,
  totalMemory: 16 * GB,
  availableMemory: 8 * GB,
  loadAverage1m: 1.5
})

function readerOf(environments: { id: string; name: string }[]) {
  let now = 0
  const readRemote = vi.fn(async (id: string) => {
    if (id === 'env_m1') {
      throw new Error('not answering')
    }
    return { host: machine(4) }
  })
  const reader = new GameHostCapacityReader({
    list: () => environments,
    readLocal: async () => machine(10),
    readRemote,
    now: () => now
  })
  return { reader, readRemote, advance: (ms: number) => (now += ms) }
}

describe('GameHostCapacityReader', () => {
  it('reads nothing while no environment is saved', async () => {
    const { reader, readRemote } = readerOf([])
    expect(await reader.read()).toBeNull()
    expect(readRemote).not.toHaveBeenCalled()
  })

  it('reads this Orca and each saved host, and names a silent one', async () => {
    const { reader } = readerOf([
      { id: 'env_imac', name: 'imac' },
      { id: 'env_m1', name: 'm1' }
    ])
    expect(await reader.read()).toEqual([
      { host: 'local', reading: { kind: 'ok', machine: machine(10) } },
      { host: 'imac', reading: { kind: 'ok', machine: machine(4) } },
      { host: 'm1', reading: { kind: 'unreachable' } }
    ])
  })

  it('reads a host that answers without its machine as not answering', async () => {
    const reader = new GameHostCapacityReader({
      list: () => [{ id: 'env_imac', name: 'imac' }],
      readLocal: async () => machine(10),
      readRemote: async () => ({ app: {} })
    })
    expect((await reader.read())?.[1]).toEqual({ host: 'imac', reading: { kind: 'unreachable' } })
  })

  it('serves a fresh reading without dialing again, and a stale one while it rereads', async () => {
    const { reader, readRemote, advance } = readerOf([{ id: 'env_imac', name: 'imac' }])
    await reader.read()
    advance(5_000)
    await reader.read()
    expect(readRemote).toHaveBeenCalledTimes(1)
    advance(20_000)
    const stale = await reader.read()
    expect(stale?.[1]?.reading.kind).toBe('ok')
    expect(readRemote).toHaveBeenCalledTimes(2)
  })
})
