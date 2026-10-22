import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryPressureReading } from '../../../shared/memory-pressure-types'
import { hasSetupHeadroom, WorkerSetupAdmission } from './worker-setup-admission'

const GIB = 1024 ** 3

function reading(overrides: Partial<MemoryPressureReading> = {}): MemoryPressureReading {
  return {
    totalMemory: 16 * GIB,
    availableMemory: 8 * GIB,
    swapTotal: null,
    swapUsed: null,
    kernelLevel: null,
    source: 'meminfo',
    readAt: 0,
    ...overrides
  }
}

describe('hasSetupHeadroom', () => {
  it('follows the macOS kernel level, not the available figure', () => {
    expect(
      hasSetupHeadroom(reading({ source: 'sysctl', kernelLevel: 'normal', availableMemory: GIB }))
    ).toBe(true)
    expect(hasSetupHeadroom(reading({ source: 'sysctl', kernelLevel: 'warn' }))).toBe(false)
    expect(hasSetupHeadroom(reading({ source: 'sysctl', kernelLevel: 'critical' }))).toBe(false)
  })

  it('needs a fifth of physical memory and at least 2 GiB elsewhere', () => {
    expect(hasSetupHeadroom(reading({ availableMemory: 3.3 * GIB }))).toBe(true)
    expect(hasSetupHeadroom(reading({ availableMemory: 3 * GIB }))).toBe(false)
    expect(hasSetupHeadroom(reading({ totalMemory: 8 * GIB, availableMemory: 1.9 * GIB }))).toBe(
      false
    )
  })

  it('never holds on a reading it cannot trust', () => {
    expect(hasSetupHeadroom(reading({ source: 'fallback', availableMemory: 0 }))).toBe(true)
  })
})

describe('WorkerSetupAdmission', () => {
  let memory: MemoryPressureReading
  let admission: WorkerSetupAdmission

  beforeEach(() => {
    vi.useFakeTimers()
    memory = reading()
    admission = new WorkerSetupAdmission({
      readMemory: async () => memory,
      maxHoldMs: 60_000,
      retryMs: 1_000
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const request = (taskId: string, start = vi.fn(), host = 'local') => ({
    host,
    taskId,
    label: taskId.toUpperCase(),
    start
  })

  it('runs four setups on one host one at a time, in order', async () => {
    const starts = ['b', 'c', 'd'].map(() => vi.fn())
    const results = await Promise.all([
      admission.admit(request('a')),
      admission.admit(request('b', starts[0])),
      admission.admit(request('c', starts[1])),
      admission.admit(request('d', starts[2]))
    ])

    expect(results[0]).toMatchObject({ admitted: true })
    expect(results.slice(1)).toEqual([
      { admitted: false, position: 1, waitingOn: 'A' },
      { admitted: false, position: 2, waitingOn: 'A' },
      { admitted: false, position: 3, waitingOn: 'A' }
    ])
    expect(admission.queued().map((one) => one.taskId)).toEqual(['b', 'c', 'd'])

    const first = results[0]
    if (!first.admitted) {
      throw new Error('expected an admission')
    }
    first.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(starts[0]).toHaveBeenCalledTimes(1)
    expect(starts[1]).not.toHaveBeenCalled()
    expect(admission.queued()).toEqual([
      { host: 'local', taskId: 'c', label: 'C', position: 1, waitingOn: 'B' },
      { host: 'local', taskId: 'd', label: 'D', position: 2, waitingOn: 'B' }
    ])

    const releaseB = starts[0].mock.calls[0][0] as () => void
    releaseB()
    releaseB()
    await vi.advanceTimersByTimeAsync(0)
    expect(starts[1]).toHaveBeenCalledTimes(1)
    expect(starts[2]).not.toHaveBeenCalled()
  })

  it('holds the head on low memory even with the slot free, and admits once memory returns', async () => {
    memory = reading({ availableMemory: GIB })
    const start = vi.fn()

    expect(await admission.admit(request('a', start))).toEqual({
      admitted: false,
      position: 1,
      waitingOn: 'memory: 1.0 GB free, needs 3.2 GB'
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(start).not.toHaveBeenCalled()

    memory = reading()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(start).toHaveBeenCalledTimes(1)
    expect(admission.queued()).toEqual([])
  })

  it('keeps one setup at a time on an SSH host without reading local memory', async () => {
    memory = reading({ availableMemory: 0 })
    const remote = await admission.admit(request('a', vi.fn(), 'ssh:conn-1'))
    const second = await admission.admit(request('b', vi.fn(), 'ssh:conn-1'))
    const otherHost = await admission.admit(request('c', vi.fn(), 'ssh:conn-2'))

    expect(remote).toMatchObject({ admitted: true })
    expect(second).toEqual({ admitted: false, position: 1, waitingOn: 'A' })
    expect(otherHost).toMatchObject({ admitted: true })
  })

  it('frees a slot held past the maximum hold', async () => {
    const start = vi.fn()
    await admission.admit(request('a'))
    await admission.admit(request('b', start))

    await vi.advanceTimersByTimeAsync(59_000)
    expect(start).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('frees the slot when a drained start throws', async () => {
    const next = vi.fn()
    const first = await admission.admit(request('a'))
    await admission.admit(
      request(
        'b',
        vi.fn(() => {
          throw new Error('start failed')
        })
      )
    )
    await admission.admit(request('c', next))
    if (!first.admitted) {
      throw new Error('expected an admission')
    }

    first.release()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('names the tasks whose start holds a slot, so a drained start is not taken for paused', async () => {
    const first = await admission.admit(request('a'))
    await admission.admit(request('b'))
    expect(admission.startingTaskIds()).toEqual(['a'])

    if (!first.admitted) {
      throw new Error('expected an admission')
    }
    first.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(admission.startingTaskIds()).toEqual(['b'])
  })

  it('answers a repeated request for a queued task with its place, not a second entry', async () => {
    await admission.admit(request('a'))
    await admission.admit(request('b'))

    expect(await admission.admit(request('b'))).toEqual({
      admitted: false,
      position: 1,
      waitingOn: 'A'
    })
    expect(admission.queued()).toHaveLength(1)
  })
})
