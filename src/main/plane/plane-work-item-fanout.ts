// Cross-workspace fan-out for work-item reads. Split from work-items.ts to
// stay under the oxlint max-lines cap without a suppression.
import {
  acquire,
  clearWorkspaceTokenOnAuthError,
  release,
  type PlaneClientForWorkspace
} from './client'
import { runBoundedIntegrationFanout } from '../integration-fanout'
import { boundedIntegrationErrorLog } from '../integration-error-message'
import type { PlaneWorkItem, PlaneWorkspaceSelection } from '../../shared/plane-types'

function shouldSurfaceFailure(
  selection: PlaneWorkspaceSelection | null | undefined,
  entryCount: number
): boolean {
  return selection !== 'all' && entryCount <= 1
}

// Fans out across connected Plane workspaces (getClients), bounded at
// MAX_CONCURRENT=4 by runBoundedIntegrationFanout, preserving entry order
// and truncating deterministically via the shared pagination budget.
// tolerateFailures mirrors Jira's multi-site search: a computed filter can
// swallow a single failing connection under 'all', but raw caller PQL
// (search) always surfaces its error so a bad query never fails silently.
export async function fetchAcrossClients(
  entries: PlaneClientForWorkspace[],
  selection: PlaneWorkspaceSelection | null | undefined,
  load: (client: PlaneClientForWorkspace) => Promise<PlaneWorkItem[]>,
  tolerateFailures: boolean
): Promise<PlaneWorkItem[]> {
  const surfaceFailure = !tolerateFailures || shouldSurfaceFailure(selection, entries.length)
  const failures: Error[] = []
  const fanout = await runBoundedIntegrationFanout(
    entries,
    async (client) => {
      await acquire()
      try {
        return await load(client)
      } catch (error) {
        clearWorkspaceTokenOnAuthError(client, error)
        if (surfaceFailure) {
          throw error
        }
        console.warn('[plane] work item fan-out entry failed:', boundedIntegrationErrorLog(error))
        failures.push(error instanceof Error ? error : new Error(String(error)))
        return [] as PlaneWorkItem[]
      } finally {
        release()
      }
    },
    (items) => items
  )
  if (fanout.truncated) {
    console.warn(
      '[plane] Cross-workspace work items exceeded their aggregate result budget; truncating.'
    )
  }
  if (tolerateFailures && failures.length === entries.length && entries.length > 0) {
    throw failures[0]
  }
  return fanout.results.flat()
}
