import { FolderTree, GitBranch, GitPullRequest, List, Pin } from 'lucide-react'
import type React from 'react'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { branchName } from '../../../../lib/git-utils'
import { UNGROUPED_PROJECT_GROUP_KEY } from '../../../../../../shared/project-groups'
import type { AppState } from '../../../../store/types'
import {
  getGitHubPRCacheKey,
  getLegacyGitHubPRCacheKey
} from '../../../../store/slices/github-cache-key'
import { translate } from '@/i18n/i18n'

export type PRGroupKey = 'with-pr' | 'without-pr'

export const PR_GROUP_ORDER: PRGroupKey[] = ['with-pr', 'without-pr']

export const PR_GROUP_META: Record<
  PRGroupKey,
  {
    label: string
    icon: React.ComponentType<{ className?: string }>
    tone: string
  }
> = {
  'with-pr': {
    get label() {
      return translate(
        'auto.components.sidebar.worktree.list.grouping.group.keys.26a4613f4c',
        'With PR'
      )
    },
    icon: GitPullRequest,
    tone: 'text-foreground'
  },
  'without-pr': {
    get label() {
      return translate(
        'auto.components.sidebar.worktree.list.grouping.group.keys.9694b028e6',
        'Without PR'
      )
    },
    icon: GitBranch,
    tone: 'text-muted-foreground'
  }
}

export const PROJECT_GROUP_META = {
  tone: 'text-foreground',
  icon: FolderTree
} as const

export function getProjectGroupHeaderKey(groupId: string | null): string {
  return groupId ? `project-group:${groupId}` : UNGROUPED_PROJECT_GROUP_KEY
}

export const PINNED_GROUP_KEY = 'pinned'

export const PINNED_GROUP_META = {
  get label() {
    return translate('auto.components.sidebar.worktree.list.groups.4aeefc5996', 'Pinned')
  },
  tone: 'text-foreground',
  icon: Pin
} as const

export const ALL_GROUP_KEY = 'all'

export const ALL_GROUP_META = {
  get label() {
    return translate('auto.components.sidebar.worktree.list.groups.0ed04075b8', 'All')
  },
  tone: 'text-foreground',
  icon: List
} as const

export const LINEAGE_GROUP_PREFIX = 'lineage:'

export function getLineageGroupKey(worktreeId: string): string {
  return `${LINEAGE_GROUP_PREFIX}${worktreeId}`
}

export function getPRGroupKey(
  worktree: Worktree,
  repoMap: Map<string, Repo>,
  prCache: Record<string, unknown> | null,
  settings?: AppState['settings']
): PRGroupKey {
  return getWorktreePRState(worktree, repoMap, prCache, settings) === null
    ? 'without-pr'
    : 'with-pr'
}

/** The cached PR state for a worktree's branch, or null when it has none. */
export function getWorktreePRState(
  worktree: Worktree,
  repoMap: Map<string, Repo>,
  prCache: Record<string, unknown> | null,
  settings?: AppState['settings']
): string | null {
  const repo = repoMap.get(worktree.repoId)
  const branch = branchName(worktree.branch)
  const repoScopedCacheKey =
    repo && branch
      ? getGitHubPRCacheKey(
          repo.path,
          repo.id,
          branch,
          settings,
          repo.connectionId,
          repo.executionHostId,
          true
        )
      : ''
  const canUseLegacyPRCache = repo !== undefined && !repo.connectionId && !repo.executionHostId
  const legacyRepoScopedCacheKey =
    canUseLegacyPRCache && branch ? getLegacyGitHubPRCacheKey(repo.path, repo.id, branch) : ''
  const legacyPathScopedCacheKey =
    canUseLegacyPRCache && branch ? getLegacyGitHubPRCacheKey(repo.path, undefined, branch) : ''
  // Why: PR refreshes now write repo-id scoped entries; legacy path entries may
  // still exist from persisted cache, but must not override fresher repo data.
  const prEntry = prCache
    ? ((repoScopedCacheKey
        ? (prCache[repoScopedCacheKey] as { data?: { state?: string } } | undefined)
        : undefined) ??
      (legacyRepoScopedCacheKey
        ? (prCache[legacyRepoScopedCacheKey] as { data?: { state?: string } } | undefined)
        : undefined) ??
      (legacyPathScopedCacheKey
        ? (prCache[legacyPathScopedCacheKey] as { data?: { state?: string } } | undefined)
        : undefined))
    : undefined
  return prEntry?.data ? (prEntry.data.state ?? 'open') : null
}

/**
 * Emit a "Pinned" header + its items into `result`.
 *
 * Why: the dedicated Pinned section is always present for pinned worktrees;
 * the display policy decides whether their natural group rows also render.
 */
