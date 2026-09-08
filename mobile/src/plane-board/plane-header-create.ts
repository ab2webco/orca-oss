import type {
  PlaneMobileProject,
  PlaneMobileState,
  PlaneMobileWorkItem
} from '../tasks/plane-mobile-work-item-read'
import type { RpcClient } from '../transport/rpc-client'
import { createPlaneWorkItem, type PlaneCreateResult } from './plane-work-item-create'

export type PlaneHeaderCreateRequest = {
  projectId: string | null
  workspaceId: string | null
  /** The column the card lands in: the board's first column, else the project's first state. */
  defaultStateId: string | null
  title: string
}

/** The header `+` route: title only, the detail edits the rest. Scope and title
 *  validation live in createPlaneWorkItem, so a missing project or column answers
 *  with the same text the column composer shows. */
export function createPlaneWorkItemFromHeader(
  client: RpcClient,
  request: PlaneHeaderCreateRequest
): Promise<PlaneCreateResult> {
  return createPlaneWorkItem(client, {
    projectId: request.projectId ?? '',
    workspaceId: request.workspaceId,
    name: request.title,
    stateId: request.defaultStateId ?? ''
  })
}

export type PlaneWorkItemStub = {
  id: string
  identifier: string
  title: string
  project: PlaneMobileProject
  state: PlaneMobileState
  workspaceId: string | null
}

/** The card as the phone knows it before the re-read: what the detail opens with when
 *  the created row is not in the fresh read yet. */
export function stubPlaneWorkItem({
  id,
  identifier,
  title,
  project,
  state,
  workspaceId
}: PlaneWorkItemStub): PlaneMobileWorkItem {
  return {
    id,
    identifier,
    title,
    url: '',
    workspaceId: workspaceId ?? undefined,
    project,
    state,
    priority: 'none',
    assignees: [],
    updatedAt: new Date().toISOString()
  }
}
