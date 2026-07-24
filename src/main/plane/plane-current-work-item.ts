import type { LinkedPlaneWorkItem } from '../../shared/types'

// Ids resolved from a worktree's persisted Plane link. Mirrors the Linear
// getLinearCurrentIssueFromWorktree reader, but Plane retrieval needs the
// project scope, so identifier and projectId are both required to qualify.
export type PlaneCurrentWorkItemLink = {
  identifier: string
  projectId: string
  workspaceId?: string
  url?: string
  worktreeId?: string
  worktreePath?: string
}

// Reads the Plane work item link persisted on a worktree at creation time.
// Returns null when the worktree carries no usable Plane link (never throws),
// so callers can cleanly fall back to requiring an explicit id.
export function getPlaneCurrentWorkItemFromWorktree(worktree: {
  id: string
  path: string
  linkedPlaneWorkItem?: LinkedPlaneWorkItem | null
}): PlaneCurrentWorkItemLink | null {
  const linked = worktree.linkedPlaneWorkItem
  const identifier = linked?.identifier?.trim()
  const projectId = linked?.projectId?.trim()
  if (!identifier || !projectId) {
    return null
  }
  const workspaceId = linked?.workspaceId?.trim()
  return {
    identifier,
    projectId,
    ...(workspaceId ? { workspaceId } : {}),
    ...(linked?.url ? { url: linked.url } : {}),
    worktreeId: worktree.id,
    worktreePath: worktree.path
  }
}
