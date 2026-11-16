import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'

export type ResumeStripTarget = {
  workspaceId: string
  projectName: string
  workspaceName: string
  lastActivityAt: number
}

/** What the Retomar strip names; null once the workspace is archived or gone. Keys on id only, so folder and SSH workspaces resolve alike. */
export function resolveResumeStripTarget(args: {
  workspaceId: string
  repos: readonly Repo[]
  worktreesByRepo: Readonly<Record<string, readonly Worktree[]>>
  folderWorkspaces: readonly FolderWorkspace[]
  projectGroups: readonly ProjectGroup[]
}): ResumeStripTarget | null {
  const scope = parseWorkspaceKey(args.workspaceId)
  if (scope?.type === 'folder') {
    const folder = args.folderWorkspaces.find((one) => one.id === scope.folderWorkspaceId)
    if (!folder || folder.isArchived) {
      return null
    }
    const group = args.projectGroups.find((one) => one.id === folder.projectGroupId)
    return {
      workspaceId: args.workspaceId,
      projectName: group?.name ?? '',
      workspaceName: folder.name,
      lastActivityAt: folder.lastActivityAt
    }
  }
  for (const [repoId, worktrees] of Object.entries(args.worktreesByRepo)) {
    const worktree = worktrees.find((one) => one.id === args.workspaceId)
    if (!worktree) {
      continue
    }
    if (worktree.isArchived) {
      return null
    }
    const repo = args.repos.find((one) => one.id === repoId)
    return {
      workspaceId: args.workspaceId,
      projectName: repo?.displayName ?? '',
      workspaceName: worktree.displayName || worktree.branch.replace(/^refs\/heads\//, ''),
      lastActivityAt: worktree.lastActivityAt
    }
  }
  return null
}
