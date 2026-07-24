import type { FolderWorkspaceLinkedTask, LinkedPlaneWorkItem } from '../../../shared/types'
import type { LinkedWorkItemSummary } from './new-workspace'

// Builds the durable Plane link persisted on a new worktree so the CLI
// `--current` shortcut can later resolve the work item without an explicit id.
// Mirrors how the composer derives linkedLinearIssue from the linked summary:
// only a Plane-provider item carrying both identifier and project id qualifies;
// anything else yields undefined so no link is written.
export function buildComposerLinkedPlaneWorkItem(
  linkedWorkItem: LinkedWorkItemSummary | null,
  provider: FolderWorkspaceLinkedTask['provider'] | null
): LinkedPlaneWorkItem | undefined {
  if (!linkedWorkItem || provider !== 'plane') {
    return undefined
  }
  const identifier = linkedWorkItem.planeIdentifier?.trim()
  const projectId = linkedWorkItem.planeProjectId?.trim()
  if (!identifier || !projectId) {
    return undefined
  }
  const workspaceId = linkedWorkItem.planeWorkspaceId?.trim()
  return {
    identifier,
    projectId,
    ...(workspaceId ? { workspaceId } : {}),
    ...(linkedWorkItem.url ? { url: linkedWorkItem.url } : {})
  }
}
