import type { ProjectTier } from './project-urgency-tier'
import type { Row } from './row-types'

/** Where a project sits inside its tier: its activity at the moment it entered that tier. */
export type ProjectTierEntry = { tier: ProjectTier; enteredAt: number }

/** Session memory of each active project's tier entry, keyed by project header key. */
export type ProjectTierMemory = ReadonlyMap<string, ProjectTierEntry>

/**
 * Proposal §4: inside a tier the order is frozen, so new output does not move a project past its
 * neighbours; it moves only when its tier changes, entering the new tier by its activity then.
 */
export function enterProjectTier(
  key: string,
  tier: ProjectTier,
  activityAt: number,
  memory: ProjectTierMemory
): ProjectTierEntry {
  const remembered = memory.get(key)
  return remembered && remembered.tier === tier ? remembered : { tier, enteredAt: activityAt }
}

export function compareProjectTierEntries(a: ProjectTierEntry, b: ProjectTierEntry): number {
  return a.tier - b.tier || b.enteredAt - a.enteredAt
}

/** The memory a build leaves behind: every active project header it drew, nothing else. */
export function nextProjectTierMemory(rows: readonly Row[]): ProjectTierMemory {
  const memory = new Map<string, ProjectTierEntry>()
  for (const row of rows) {
    if (row.type === 'header' && row.urgency) {
      memory.set(row.key, { tier: row.urgency.tier, enteredAt: row.urgency.enteredAt })
    }
  }
  return memory
}

export function sameProjectTierMemory(a: ProjectTierMemory, b: ProjectTierMemory): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const [key, entry] of a) {
    const other = b.get(key)
    if (!other || other.tier !== entry.tier || other.enteredAt !== entry.enteredAt) {
      return false
    }
  }
  return true
}
