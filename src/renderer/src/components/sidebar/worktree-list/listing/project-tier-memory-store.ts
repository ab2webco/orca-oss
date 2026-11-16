import { useEffect, useSyncExternalStore } from 'react'
import { nextProjectTierMemory, sameProjectTierMemory } from '../grouping/project-tier-order'
import type { ProjectTierMemory } from '../grouping/project-tier-order'
import type { Row } from '../grouping/row-types'

// Why module state: the frozen order lives for the renderer session only and is never persisted.
let memory: ProjectTierMemory = new Map()
const listeners = new Set<() => void>()

export function getProjectTierMemory(): ProjectTierMemory {
  return memory
}

export function subscribeProjectTierMemory(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Records the tier entries a build drew; returns whether the memory changed. */
export function commitProjectTierMemory(rows: readonly Row[]): boolean {
  const next = nextProjectTierMemory(rows)
  if (sameProjectTierMemory(memory, next)) {
    return false
  }
  memory = next
  for (const listener of listeners) {
    listener()
  }
  return true
}

export function resetProjectTierMemory(): void {
  memory = new Map()
}

export function useProjectTierMemory(): ProjectTierMemory {
  return useSyncExternalStore(
    subscribeProjectTierMemory,
    getProjectTierMemory,
    getProjectTierMemory
  )
}

/** Why after render: the next build must read the entries this one drew, never its own output. */
export function useCommitProjectTierMemory(rows: readonly Row[]): void {
  useEffect(() => {
    commitProjectTierMemory(rows)
  }, [rows])
}
