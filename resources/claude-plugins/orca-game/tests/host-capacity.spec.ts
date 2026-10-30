import { afterEach, describe, expect, it } from 'vitest'

import { parseGameState } from '../hooks/game-state'
import { setGameLocale } from '../hooks/game-strings'
import { hostCapacityLinesOf } from '../hooks/host-capacity'

const GB = 1024 ** 3
const imac = {
  host: 'imac',
  running: 2,
  status: 'ok' as const,
  cpuCoreCount: 4,
  totalMemory: 52 * GB,
  availableMemory: 4.9 * GB,
  loadAverage1m: 3.8
}
const local = { ...imac, host: 'local', running: 3, cpuCoreCount: 10, totalMemory: 16 * GB }
const silent = { host: 'm1', running: 1, status: 'unreachable' as const }

const hostsOf = (hostCapacity: unknown) =>
  parseGameState(JSON.stringify({ agents: [], hostCapacity }))?.hostCapacity

describe('host capacity', () => {
  afterEach(() => setGameLocale('en'))

  it('keeps each host Orca publishes and drops a malformed one', () => {
    expect(
      hostsOf([local, imac, silent, { host: 'x' }, { ...imac, cpuCoreCount: 'four' }])
    ).toEqual([local, imac, silent])
    expect(hostsOf('lots')).toBeUndefined()
    expect(parseGameState(JSON.stringify({ agents: [] }))?.hostCapacity).toBeUndefined()
  })

  it('says per host its members, cores, free memory and load, and warns on low memory', () => {
    expect(hostCapacityLinesOf([local, imac, silent], false)).toEqual([
      {
        key: 'local',
        text: '⌂ local 3 running · 10 cores · 4.9 of 16 GB free · load 3.8',
        warn: false
      },
      {
        key: 'imac',
        text: '⌂ imac 2 running · 4 cores · 4.9 of 52 GB free · load 3.8 · low memory',
        warn: true
      },
      { key: 'm1', text: '⌂ m1 1 running · not answering', warn: true }
    ])
  })

  it('shortens each line for a phone and keeps every figure', () => {
    expect(hostCapacityLinesOf([imac, silent], true).map((one) => one.text)).toEqual([
      '⌂ imac 2▸ 4c 4.9/52G L3.8 !mem',
      '⌂ m1 1▸ ?'
    ])
  })

  it('speaks the session language', () => {
    setGameLocale('es')
    expect(hostCapacityLinesOf([imac, silent], false).map((one) => one.text)).toEqual([
      '⌂ imac 2 activos · 4 núcleos · 4.9 de 52 GB libres · carga 3.8 · poca memoria',
      '⌂ m1 1 activos · no responde'
    ])
  })
})
