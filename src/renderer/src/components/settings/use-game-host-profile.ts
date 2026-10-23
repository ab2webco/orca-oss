import { useEffect } from 'react'
import type { GameHostProfile } from '../../../../shared/orchestrator-game-lead'
import { useAppStore } from '../../store'

/** Orca's machine as the memory snapshot reads it; null until the first snapshot arrives. */
export function useGameHostProfile(): GameHostProfile | null {
  const totalMemory = useAppStore((state) => state.memorySnapshot?.host.totalMemory ?? null)
  const cpuCoreCount = useAppStore((state) => state.memorySnapshot?.host.cpuCoreCount ?? null)
  const fetchMemorySnapshot = useAppStore((state) => state.fetchMemorySnapshot)
  const isKnown = totalMemory !== null && cpuCoreCount !== null
  useEffect(() => {
    if (!isKnown) {
      void fetchMemorySnapshot()
    }
  }, [isKnown, fetchMemorySnapshot])
  return isKnown ? { totalMemory, cpuCoreCount } : null
}
