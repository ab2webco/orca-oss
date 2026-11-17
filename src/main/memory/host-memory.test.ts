import { beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'

const { execFileMock, readFileMock, statfsMock, cpuUsageMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  readFileMock: vi.fn(),
  statfsMock: vi.fn(),
  cpuUsageMock: vi.fn()
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
  readFile: (file: string, encoding: string) => readFileMock(file, encoding),
  statfs: (dir: string) => statfsMock(dir)
}))

vi.mock('./host-cpu-usage', () => ({ readHostCpuUsage: () => cpuUsageMock() }))

async function loadHostMemory() {
  vi.resetModules()
  return import('./host-memory')
}

describe('host memory', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    execFileMock.mockReset()
    readFileMock.mockReset()
    statfsMock.mockReset()
    cpuUsageMock.mockReset()
    vi.spyOn(os, 'totalmem').mockReturnValue(1_000)
    vi.spyOn(os, 'freemem').mockReturnValue(100)
    vi.spyOn(os, 'cpus').mockReturnValue([{}, {}] as ReturnType<typeof os.cpus>)
    vi.spyOn(os, 'loadavg').mockReturnValue([1.5, 1, 0.5])
  })

  it('uses macOS memory-pressure availability instead of immediate free pages', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    execFileMock.mockImplementation((_file, _args, _options, callback) =>
      callback(null, 'System-wide memory free percentage: 79%')
    )
    const { collectHostMemory } = await loadHostMemory()

    const host = await collectHostMemory()

    expect(host).toMatchObject({
      totalMemory: 1_000,
      freeMemory: 100,
      availableMemory: 790,
      availableMemorySource: 'memory-pressure',
      usedMemory: 210,
      memoryUsagePercent: 21,
      cpuCoreCount: 2,
      loadAverage1m: 1.5
    })
    expect(execFileMock.mock.calls[0][0]).toBe('/usr/bin/memory_pressure')
    expect(execFileMock.mock.calls[0][1]).toEqual(['-Q'])
  })

  it('falls back once when macOS availability cannot be read', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    execFileMock.mockImplementation((_file, _args, _options, callback) =>
      callback(new Error('unsupported'), '')
    )
    const { collectHostMemory } = await loadHostMemory()

    const first = await collectHostMemory()
    const second = await collectHostMemory()

    expect(first).toMatchObject({
      availableMemory: 100,
      availableMemorySource: 'free-memory',
      usedMemory: 900,
      memoryUsagePercent: 90
    })
    expect(second.availableMemorySource).toBe('free-memory')
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('uses Linux MemAvailable and keeps the value within physical RAM', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux')
    vi.spyOn(os, 'totalmem').mockReturnValue(4 * 1024 * 1024)
    vi.spyOn(os, 'freemem').mockReturnValue(512 * 1024)
    readFileMock.mockResolvedValue('MemTotal: 4096 kB\nMemAvailable: 2048 kB\n')
    const { collectHostMemory } = await loadHostMemory()

    const host = await collectHostMemory()

    expect(host).toMatchObject({
      availableMemory: 2 * 1024 * 1024,
      availableMemorySource: 'proc-meminfo',
      usedMemory: 2 * 1024 * 1024,
      memoryUsagePercent: 50
    })
  })

  it('uses the bounded Node value on Windows', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    const { collectHostMemory } = await loadHostMemory()

    const host = await collectHostMemory()

    expect(host.availableMemory).toBe(100)
    expect(host.availableMemorySource).toBe('free-memory')
    expect(execFileMock).not.toHaveBeenCalled()
    expect(readFileMock).not.toHaveBeenCalled()
  })
})

describe('host CPU use and workspaces disk', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    statfsMock.mockReset()
    cpuUsageMock.mockReset()
    vi.spyOn(os, 'platform').mockReturnValue('win32')
  })

  it('adds the CPU use now and the workspaces folder disk', async () => {
    cpuUsageMock.mockResolvedValue(42)
    statfsMock.mockResolvedValue({ bsize: 1_000, blocks: 900, bavail: 300 })
    const { collectHostMemory } = await loadHostMemory()

    const host = await collectHostMemory({ workspaceDir: '/home/me/orca/workspaces' })

    expect(host).toMatchObject({
      cpuUsagePercent: 42,
      workspaceDiskTotal: 900_000,
      workspaceDiskFree: 300_000
    })
    expect(statfsMock).toHaveBeenCalledWith('/home/me/orca/workspaces')
  })

  it('leaves out what it cannot read, so a reader shows it unknown and never zero', async () => {
    cpuUsageMock.mockResolvedValue(undefined)
    const { collectHostMemory } = await loadHostMemory()

    const host = await collectHostMemory()

    expect(host).not.toHaveProperty('cpuUsagePercent')
    expect(host).not.toHaveProperty('workspaceDiskTotal')
    expect(host).not.toHaveProperty('workspaceDiskFree')
    expect(statfsMock).not.toHaveBeenCalled()
  })
})

describe('host availability parsers', () => {
  it('parses bounded macOS percentages', async () => {
    const { parseDarwinAvailableMemory } = await loadHostMemory()

    expect(parseDarwinAvailableMemory('System-wide memory free percentage: 42%', 1_000)).toBe(420)
    expect(parseDarwinAvailableMemory('System-wide memory free percentage: 101%', 1_000)).toBeNull()
  })

  it('parses Linux MemAvailable in KiB', async () => {
    const { parseLinuxAvailableMemory } = await loadHostMemory()

    expect(parseLinuxAvailableMemory('MemAvailable:    1234 kB\n')).toBe(1234 * 1024)
    expect(parseLinuxAvailableMemory('MemFree: 1234 kB\n')).toBeNull()
  })
})
