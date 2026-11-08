import { isFolderRepo } from '../../../../shared/repo-kind'
import type { Repo } from '../../../../shared/types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'

const FOLDER_PROJECT_PREFIX = 'folder-workspace:'

export type TeamPanelProjectSource = {
  repos: readonly (Pick<Repo, 'id' | 'displayName'> & Partial<Pick<Repo, 'kind'>>)[]
  worktreesByRepo: Readonly<Record<string, readonly { id: string }[] | undefined>>
  projectGroups?: readonly { id: string; name: string }[]
  folderWorkspaces?: readonly { id: string; projectGroupId: string }[]
}

/**
 * The active project's name, workspaces and kind. A folder workspace's project is its group,
 * which no repo record names, so the panel never found its lead (ORCA-1135).
 */
export function teamPanelProjectOf(
  state: TeamPanelProjectSource,
  repoId: string
): { name: string; worktreeIds: string[]; isFolder: boolean } | null {
  if (repoId.startsWith(FOLDER_PROJECT_PREFIX)) {
    const groupId = repoId.slice(FOLDER_PROJECT_PREFIX.length)
    const group = state.projectGroups?.find((one) => one.id === groupId)
    return group
      ? {
          name: group.name,
          worktreeIds: (state.folderWorkspaces ?? [])
            .filter((one) => one.projectGroupId === groupId)
            .map((one) => folderWorkspaceKey(one.id)),
          isFolder: true
        }
      : null
  }
  const repo = state.repos.find((one) => one.id === repoId)
  return repo
    ? {
        name: repo.displayName,
        worktreeIds: (state.worktreesByRepo[repoId] ?? []).map((one) => one.id),
        isFolder: isFolderRepo(repo)
      }
    : null
}
