import type {
  MemoryPressureKernelLevel,
  MemoryPressureReading
} from '../../shared/memory-pressure-types'
import { availablePercentOf, isKernelAuthoritative } from './memory-pressure-evaluation'

const WORSE_HORIZON_MINUTES = 5
const WORSE_AVAILABLE_DROP_PERCENT = 5

export type MemoryPressureSeverity = {
  kernelRank: number
  availablePercent: number
  kernelAuthoritative: boolean
  minutesToExhaustion: number | null
}

const KERNEL_RANK: Record<MemoryPressureKernelLevel, number> = { normal: 0, warn: 1, critical: 2 }

export function severityOf(
  reading: MemoryPressureReading,
  minutesToExhaustion: number | null
): MemoryPressureSeverity {
  return {
    kernelRank: reading.kernelLevel ? KERNEL_RANK[reading.kernelLevel] : 0,
    availablePercent: availablePercentOf(reading),
    kernelAuthoritative: isKernelAuthoritative(reading),
    minutesToExhaustion
  }
}

export function worstOf(
  a: MemoryPressureSeverity,
  b: MemoryPressureSeverity
): MemoryPressureSeverity {
  const minutes = [a.minutesToExhaustion, b.minutesToExhaustion].filter((m) => m !== null)
  return {
    kernelRank: Math.max(a.kernelRank, b.kernelRank),
    availablePercent: Math.min(a.availablePercent, b.availablePercent),
    kernelAuthoritative: b.kernelAuthoritative,
    minutesToExhaustion: minutes.length > 0 ? Math.min(...minutes) : null
  }
}

/**
 * Worse = the kernel level rises, the time to exhaustion drops under five minutes, or (where the
 * level is honest, so not macOS) free memory falls five more points. `allowAvailableDrop` is off
 * across episodes: inside the minimum interval only a jump in kind reopens.
 */
export function isWorseSeverity(
  current: MemoryPressureSeverity,
  reference: MemoryPressureSeverity,
  allowAvailableDrop: boolean
): boolean {
  if (current.kernelRank > reference.kernelRank) {
    return true
  }
  const nowShort =
    current.minutesToExhaustion !== null && current.minutesToExhaustion < WORSE_HORIZON_MINUTES
  const wasShort =
    reference.minutesToExhaustion !== null && reference.minutesToExhaustion < WORSE_HORIZON_MINUTES
  if (nowShort && !wasShort) {
    return true
  }
  return (
    allowAvailableDrop &&
    !current.kernelAuthoritative &&
    current.availablePercent <= reference.availablePercent - WORSE_AVAILABLE_DROP_PERCENT
  )
}
