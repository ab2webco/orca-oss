import type { ProjectOrderBy } from '../../../shared/ui-chrome-types'
import { normalizeProjectOrderBy } from './ui-selection-normalization'

type StoredProjectOrder = {
  projectOrderBy?: unknown
  _projectOrderNeedsYouMigrated?: unknown
}

/**
 * Lead decision (ORCA-1216): a stored 'recent' becomes 'needs-you' once; the flag keeps any later
 * choice, and a stored 'manual' stays. Reads the raw value so a fresh default is never migrated.
 */
export function migrateProjectOrderByOnLoad(stored: StoredProjectOrder | undefined): {
  projectOrderBy: ProjectOrderBy
  needsSave: boolean
} {
  const migrated = stored?._projectOrderNeedsYouMigrated === true
  if (!migrated && stored?.projectOrderBy === 'recent') {
    return { projectOrderBy: 'needs-you', needsSave: true }
  }
  return { projectOrderBy: normalizeProjectOrderBy(stored?.projectOrderBy), needsSave: !migrated }
}
