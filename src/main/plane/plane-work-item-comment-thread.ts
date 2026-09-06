// Two readers over one fetch. `readWorkItemCommentThread` reports why a read
// failed; `listWorkItemComments` keeps the published `PlaneComment[]` shape its
// callers already decode, where a failure is indistinguishable from an empty
// thread. New callers that must tell those apart use the former.
import {
  acquire,
  clearWorkspaceTokenOnAuthError,
  planeRequest,
  release,
  type PlaneClientForWorkspace
} from './client'
import {
  INTEGRATION_PAGINATION_MAX_PAGES,
  IntegrationPaginationBudget
} from '../integration-pagination-budget'
import { fetchAllPlanePages, type PlanePage } from './plane-cursor-pagination'
import { mapPlaneComment } from './plane-work-item-mappers'
import {
  commentsPath,
  commentsQuery,
  resolveClient,
  toMutationError,
  type PlaneRecord
} from './plane-work-item-writes'
import type {
  PlaneComment,
  PlaneCommentThreadRead,
  PlaneWorkspaceSelection
} from '../../shared/plane-types'

export type PlaneCommentThreadArgs = {
  projectId: string
  workItemId: string
  workspaceId?: PlaneWorkspaceSelection | null
}

const NOT_CONNECTED_MESSAGE = 'Not connected to Plane.'

async function fetchComments(
  client: PlaneClientForWorkspace,
  args: PlaneCommentThreadArgs
): Promise<PlaneComment[]> {
  const budget = new IntegrationPaginationBudget()
  const raws = await fetchAllPlanePages<PlaneRecord>(
    (cursor) =>
      planeRequest<PlanePage<PlaneRecord>>(
        client,
        `${commentsPath(client, args.projectId, args.workItemId)}?${commentsQuery(cursor)}`
      ),
    budget,
    INTEGRATION_PAGINATION_MAX_PAGES
  )
  return raws.map(mapPlaneComment)
}

/** An unresolved workspace is a failure, not an empty thread: nothing was read. */
export async function readWorkItemCommentThread(
  args: PlaneCommentThreadArgs
): Promise<PlaneCommentThreadRead> {
  const client = resolveClient(args.workspaceId)
  if (!client) {
    return { ok: false, error: NOT_CONNECTED_MESSAGE }
  }
  await acquire()
  try {
    return { ok: true, comments: await fetchComments(client, args) }
  } catch (error) {
    clearWorkspaceTokenOnAuthError(client, error)
    return toMutationError(error, 'Failed to read the comments.')
  } finally {
    release()
  }
}

export async function listWorkItemComments(args: PlaneCommentThreadArgs): Promise<PlaneComment[]> {
  const read = await readWorkItemCommentThread(args)
  return read.ok ? read.comments : []
}
