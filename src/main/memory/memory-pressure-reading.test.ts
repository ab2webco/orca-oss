import { beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'

const { execFileMock, readFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  readFileMock: vi.fn()
}))

vi.mock('node:child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    options: unknown,
    callback: (error: Error | null, stdout: string) => void
  ) => execFileMock(file, args, options, callback)
}))

vi.mock('node:fs/promises', () => ({
  readFile: (file: string, encoding: string) => readFileMock(file, encoding)
}))

const GIB = 1024 ** 3
const MIB = 1024 ** 2

// Captured on the 16 GB Mac this feature was built on, while it was not under pressure.
const DARWIN_SYSCTL_FIXTURE = [
  '58',
  '1',
  'total = 8192.00M  used = 7310.06M  free = 881.94M  (encrypted)'
].join('\n')

const LINUX_MEMINFO_FIXTURE = [
  'MemTotal:       16384000 kB',
  'MemFree:          512000 kB',
  'MemAvailable:    1024000 kB',
  'SwapCached:            0 kB',
  'SwapTotal:       4096000 kB',
  'SwapFree:        1024000 kB'
].join('\n')

async function loadReading() {
  vi.resetModules()
  return import('./memory-pressure-reading')
}

describe('parseDarwinPressureSysctl', () => {
  it('reads free percent, kernel level and swap from one sysctl call', async () => {
    const { parseDarwinPressureSysctl } = await loadReading()

    expect(parseDarwinPressureSysctl(DARWIN_SYSCTL_FIXTURE, 16 * GIB)).toEqual({
      availableMemory: Math.round(16 * GIB * 0.58),
      kernelLevel: 'normal',
      swapTotal: 8192 * MIB,
      swapUsed: Math.round(7310.06 * MIB)
    })
  })

  it('maps kernel levels 2 and 4 to warn and critical', async () => {
    const { parseDarwinPressureSysctl } = await loadReading()

    expect(
      parseDarwinPressureSysctl('9\n2\ntotal = 1.00G  used = 0.50G  free = 0.50G', GIB)
    ).toEqual(expect.objectContaining({ kernelLevel: 'warn', swapTotal: GIB, swapUsed: GIB / 2 }))
    expect(
      parseDarwinPressureSysctl('3\n4\ntotal = 0.00M  used = 0.00M  free = 0.00M', GIB)
    ).toEqual(expect.objectContaining({ kernelLevel: 'critical', swapTotal: 0, swapUsed: 0 }))
  })

  it('returns null when the free percentage is missing or out of range', async () => {
    const { parseDarwinPressureSysctl } = await loadReading()

    expect(parseDarwinPressureSysctl('', GIB)).toBeNull()
    expect(parseDarwinPressureSysctl('140\n1\n', GIB)).toBeNull()
  })
})

describe('parseLinuxMeminfoPressure', () => {
  it('reads MemAvailable and swap from one /proc/meminfo read', async () => {
    const { parseLinuxMeminfoPressure } = await loadReading()

    expect(parseLinuxMeminfoPressure(LINUX_MEMINFO_FIXTURE)).toEqual({
      totalMemory: 16384000 * 1024,
      availableMemory: 1024000 * 1024,
      swapTotal: 4096000 * 1024,
      swapUsed: 3072000 * 1024
    })
  })

  it('returns null without MemAvailable (pre-3.14 kernels)', async () => {
    const { parseLinuxMeminfoPressure } = await loadReading()

    expect(parseLinuxMeminfoPressure('MemTotal: 100 kB\nMemFree: 10 kB')).toBeNull()
  })
})

describe('readMemoryPressure', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    execFileMock.mockReset()
    readFileMock.mockReset()
    vi.spyOn(os, 'totalmem').mockReturnValue(16 * GIB)
    vi.spyOn(os, 'freemem').mockReturnValue(GIB)
  })

  it('asks sysctl once on macOS', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) =>
      callback(null, DARWIN_SYSCTL_FIXTURE)
    )
    const { readMemoryPressure } = await loadReading()

    const reading = await readMemoryPressure('darwin', 1_000)

    expect(execFileMock).toHaveBeenCalledTimes(1)
    expect(execFileMock.mock.calls[0][0]).toBe('/usr/sbin/sysctl')
    expect(execFileMock.mock.calls[0][1]).toEqual([
      '-n',
      'kern.memorystatus_level',
      'kern.memorystatus_vm_pressure_level',
      'vm.swapusage'
    ])
    expect(reading).toMatchObject({ totalMemory: 16 * GIB, kernelLevel: 'normal', readAt: 1_000 })
  })

  it('falls back to free memory with no swap when sysctl fails on macOS', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) =>
      callback(new Error('sysctl missing'), '')
    )
    const { readMemoryPressure } = await loadReading()

    expect(await readMemoryPressure('darwin', 5)).toEqual({
      totalMemory: 16 * GIB,
      availableMemory: GIB,
      swapTotal: null,
      swapUsed: null,
      kernelLevel: null,
      readAt: 5
    })
  })

  it('reads /proc/meminfo on Linux without spawning anything', async () => {
    readFileMock.mockResolvedValue(LINUX_MEMINFO_FIXTURE)
    const { readMemoryPressure } = await loadReading()

    const reading = await readMemoryPressure('linux', 7)

    expect(execFileMock).not.toHaveBeenCalled()
    expect(reading).toMatchObject({ availableMemory: 1024000 * 1024, kernelLevel: null })
  })

  it('uses the OS free figure on Windows, where swap is not reported', async () => {
    const { readMemoryPressure } = await loadReading()

    const reading = await readMemoryPressure('win32', 9)

    expect(execFileMock).not.toHaveBeenCalled()
    expect(readFileMock).not.toHaveBeenCalled()
    expect(reading).toEqual({
      totalMemory: 16 * GIB,
      availableMemory: GIB,
      swapTotal: null,
      swapUsed: null,
      kernelLevel: null,
      readAt: 9
    })
  })
})
