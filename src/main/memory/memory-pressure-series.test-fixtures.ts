import type {
  MemoryPressureKernelLevel,
  MemoryPressureReading
} from '../../shared/memory-pressure-types'
import { parseDarwinPressureSysctl, parseLinuxMeminfoPressure } from './memory-pressure-reading'

export const GIB = 1024 ** 3
export const TICK_MS = 30_000
export const MAC_TOTAL = 16 * GIB
const KERNEL_SYSCTL_VALUE: Record<MemoryPressureKernelLevel, string> = {
  normal: '1',
  warn: '2',
  critical: '4'
}

export type DarwinSample = {
  level: number
  kernel?: MemoryPressureKernelLevel
  swapUsedMiB?: number
  swapTotalMiB?: number
}

/** A reading as the 16 GB Mac reports it, run through the real sysctl parser. */
export function darwinReading(sample: DarwinSample, readAt: number): MemoryPressureReading {
  const swapTotal = sample.swapTotalMiB ?? 8192
  const swapUsed = sample.swapUsedMiB ?? 7000
  const stdout = [
    String(sample.level),
    KERNEL_SYSCTL_VALUE[sample.kernel ?? 'normal'],
    `total = ${swapTotal.toFixed(2)}M  used = ${swapUsed.toFixed(2)}M  free = ${(swapTotal - swapUsed).toFixed(2)}M  (encrypted)`
  ].join('\n')
  const parsed = parseDarwinPressureSysctl(stdout, MAC_TOTAL)
  if (!parsed) {
    throw new Error(`unparseable darwin sample ${stdout}`)
  }
  return {
    ...parsed,
    kernelLevel: parsed.kernelLevel ?? null,
    totalMemory: MAC_TOTAL,
    source: 'sysctl',
    readAt
  }
}

/** A Linux reading at the given available percent of 16 GB, through the real meminfo parser. */
export function linuxReading(availablePercent: number, readAt: number): MemoryPressureReading {
  const totalKib = 16 * 1024 * 1024
  const meminfo = [
    `MemTotal:       ${totalKib} kB`,
    `MemAvailable:   ${Math.round((totalKib * availablePercent) / 100)} kB`,
    'SwapTotal:      4194304 kB',
    'SwapFree:       4194304 kB'
  ].join('\n')
  const parsed = parseLinuxMeminfoPressure(meminfo)
  if (!parsed) {
    throw new Error('unparseable meminfo sample')
  }
  return {
    ...parsed,
    totalMemory: parsed.totalMemory ?? 0,
    kernelLevel: null,
    source: 'meminfo',
    readAt
  }
}

export function darwinSeries(samples: readonly DarwinSample[], start = 0): MemoryPressureReading[] {
  return samples.map((sample, index) => darwinReading(sample, start + index * TICK_MS))
}

export function linuxSeries(percents: readonly number[], start = 0): MemoryPressureReading[] {
  return percents.map((percent, index) => linuxReading(percent, start + index * TICK_MS))
}

function repeat<T>(pattern: readonly T[], count: number): T[] {
  return Array.from({ length: count }, (_, index) => pattern[index % pattern.length])
}

/** A cache-heavy working hour on macOS: kernel normal, level oscillating 8-12% around the
 *  default 10% threshold, swap held at ~85%. The old rule held one popup open all hour. */
export const CACHE_HEAVY_MAC_HOUR: DarwinSample[] = repeat(
  [12, 11, 10, 9, 8, 9, 10, 11, 12, 9, 11, 8].map((level) => ({ level, swapUsedMiB: 6990 })),
  120
)

/** The same hour as the cache refills and drains: the level swings 8-30%, crossing the old
 *  rule's 20% swap companion and 25% exit on every swing. */
export const CACHE_SWING_MAC_HOUR: DarwinSample[] = repeat(
  [12, 18, 24, 28, 30, 26, 22, 16, 10, 8].map((level) => ({ level, swapUsedMiB: 6990 })),
  120
)

/** Same machine with the level flat at 6%: low, but nothing is getting worse. */
export const FLAT_LOW_MAC: DarwinSample[] = repeat([{ level: 6, swapUsedMiB: 7000 }], 40)
