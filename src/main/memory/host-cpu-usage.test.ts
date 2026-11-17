import { describe, expect, it, vi } from 'vitest'
import type os from 'node:os'
import { cpuTimesOf, cpuUsagePercentOf, createHostCpuUsage } from './host-cpu-usage'

const core = (busy: number, idle: number): os.CpuInfo => ({
  model: 'test',
  speed: 1,
  times: { user: busy, nice: 0, sys: 0, idle, irq: 0 }
})

describe('cpuUsagePercentOf', () => {
  it('is the busy share of every core between two samples', () => {
    const before = cpuTimesOf([core(100, 100), core(100, 100)])
    const after = cpuTimesOf([core(160, 140), core(190, 110)])

    expect(cpuUsagePercentOf(before, after)).toBe(75)
  })

  it('is none when no time passed or the counters went back', () => {
    const sample = cpuTimesOf([core(100, 100)])

    expect(cpuUsagePercentOf(sample, sample)).toBeUndefined()
    expect(cpuUsagePercentOf(sample, cpuTimesOf([core(50, 50)]))).toBeUndefined()
  })
})

describe('createHostCpuUsage', () => {
  it('measures a short window on the first read, then the time since the last read', async () => {
    const samples = [
      cpuTimesOf([core(0, 0)]),
      cpuTimesOf([core(10, 30)]),
      cpuTimesOf([core(60, 80)])
    ]
    const wait = vi.fn(async () => {})
    let clock = 0
    const read = createHostCpuUsage({ sample: () => samples.shift()!, now: () => clock, wait })

    expect(await read()).toBe(25)
    expect(wait).toHaveBeenCalledTimes(1)
    clock = 15_000
    expect(await read()).toBe(50)
    expect(wait).toHaveBeenCalledTimes(1)
  })

  it('gives back the last figure to a read under a second after it, instead of a few-ms window', async () => {
    const samples = [cpuTimesOf([core(0, 0)]), cpuTimesOf([core(10, 30)])]
    const sample = vi.fn(() => samples.shift()!)
    let clock = 0
    const read = createHostCpuUsage({ sample, now: () => clock, wait: async () => {} })

    expect(await read()).toBe(25)
    clock = 5
    expect(await read()).toBe(25)
    expect(sample).toHaveBeenCalledTimes(2)
  })

  it('measures a fresh window when the last read is too old to say what is happening now', async () => {
    const samples = [
      cpuTimesOf([core(0, 0)]),
      cpuTimesOf([core(10, 10)]),
      cpuTimesOf([core(10, 1_000)]),
      cpuTimesOf([core(30, 1_000)])
    ]
    const wait = vi.fn(async () => {})
    let clock = 0
    const read = createHostCpuUsage({ sample: () => samples.shift()!, now: () => clock, wait })

    await read()
    clock = 10 * 60_000
    expect(await read()).toBe(100)
    expect(wait).toHaveBeenCalledTimes(2)
  })
})
