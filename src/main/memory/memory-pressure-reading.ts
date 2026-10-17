import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  MemoryPressureKernelLevel,
  MemoryPressureReading
} from '../../shared/memory-pressure-types'

const SYSCTL_TIMEOUT_MS = 1_000
const SYSCTL_MAX_BUFFER = 16 * 1024
const KIB = 1024

const SWAP_UNIT_BYTES: Record<string, number> = {
  K: KIB,
  M: KIB ** 2,
  G: KIB ** 3,
  T: KIB ** 4
}

// Why these values: XNU's kern.memorystatus_vm_pressure_level reports 1, 2 or 4.
const KERNEL_LEVELS: Record<string, MemoryPressureKernelLevel> = {
  '1': 'normal',
  '2': 'warn',
  '4': 'critical'
}

type PlatformPressure = Omit<MemoryPressureReading, 'totalMemory' | 'readAt' | 'kernelLevel'> & {
  totalMemory?: number
  kernelLevel?: MemoryPressureKernelLevel | null
}

function parseSwapField(line: string, field: 'total' | 'used'): number | null {
  const match = new RegExp(`${field} = ([\\d.]+)([KMGT])`).exec(line)
  const value = Number.parseFloat(match?.[1] ?? '')
  const unit = SWAP_UNIT_BYTES[match?.[2] ?? '']
  return Number.isFinite(value) && unit !== undefined ? Math.round(value * unit) : null
}

/** Parses `sysctl -n kern.memorystatus_level kern.memorystatus_vm_pressure_level vm.swapusage`. */
export function parseDarwinPressureSysctl(
  stdout: string,
  totalMemory: number
): Omit<PlatformPressure, 'totalMemory'> | null {
  const [levelLine = '', kernelLine = '', swapLine = ''] = stdout.split('\n')
  const freePercent = Number.parseInt(levelLine.trim(), 10)
  if (!Number.isFinite(freePercent) || freePercent < 0 || freePercent > 100 || totalMemory <= 0) {
    return null
  }
  return {
    availableMemory: Math.round((totalMemory * freePercent) / 100),
    kernelLevel: KERNEL_LEVELS[kernelLine.trim()] ?? null,
    swapTotal: parseSwapField(swapLine, 'total'),
    swapUsed: parseSwapField(swapLine, 'used')
  }
}

function meminfoBytes(meminfo: string, key: string): number | null {
  const match = new RegExp(`^${key}:\\s*(\\d+)\\s+kB$`, 'm').exec(meminfo)
  const kib = Number.parseInt(match?.[1] ?? '', 10)
  return Number.isSafeInteger(kib) && kib >= 0 ? kib * KIB : null
}

export function parseLinuxMeminfoPressure(meminfo: string): PlatformPressure | null {
  const totalMemory = meminfoBytes(meminfo, 'MemTotal')
  const availableMemory = meminfoBytes(meminfo, 'MemAvailable')
  if (totalMemory === null || availableMemory === null) {
    return null
  }
  const swapTotal = meminfoBytes(meminfo, 'SwapTotal')
  const swapFree = meminfoBytes(meminfo, 'SwapFree')
  return {
    totalMemory,
    availableMemory,
    swapTotal,
    swapUsed: swapTotal !== null && swapFree !== null ? Math.max(0, swapTotal - swapFree) : null
  }
}

function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
        maxBuffer: SYSCTL_MAX_BUFFER,
        timeout: SYSCTL_TIMEOUT_MS,
        windowsHide: true
      },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout)))
    )
  })
}

async function readPlatformPressure(
  platform: NodeJS.Platform,
  totalMemory: number
): Promise<PlatformPressure | null> {
  try {
    if (platform === 'darwin') {
      const stdout = await execFileText('/usr/sbin/sysctl', [
        '-n',
        'kern.memorystatus_level',
        'kern.memorystatus_vm_pressure_level',
        'vm.swapusage'
      ])
      return parseDarwinPressureSysctl(stdout, totalMemory)
    }
    if (platform === 'linux') {
      return parseLinuxMeminfoPressure(
        await readFile(path.join(path.sep, 'proc', 'meminfo'), 'utf8')
      )
    }
  } catch {
    // Restricted or non-procfs hosts fall back to Node's free-memory figure.
  }
  return null
}

/** One cheap system reading: at most one sysctl spawn on macOS, one file read on Linux, none on Windows. */
export async function readMemoryPressure(
  platform: NodeJS.Platform = os.platform(),
  now: number = Date.now()
): Promise<MemoryPressureReading> {
  const osTotal = Math.max(0, os.totalmem())
  const platformPressure = await readPlatformPressure(platform, osTotal)
  const totalMemory = platformPressure?.totalMemory ?? osTotal
  return {
    totalMemory,
    availableMemory: Math.min(
      totalMemory,
      platformPressure?.availableMemory ?? Math.max(0, os.freemem())
    ),
    swapTotal: platformPressure?.swapTotal ?? null,
    swapUsed: platformPressure?.swapUsed ?? null,
    kernelLevel: platformPressure?.kernelLevel ?? null,
    readAt: now
  }
}
