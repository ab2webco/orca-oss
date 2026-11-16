/**
 * Seeds the sidebar with repos on several hosts through window.__store, the convention for
 * provider-backed screens (docs/reference/rendered-ui-checks.md). The remote hosts are SSH
 * targets that exist only in the store: their rows and connection state are seeded, nothing
 * connects anywhere.
 */

import type { Page } from '@stablyai/playwright-test'
import type { ExecutionHostId } from '../../../src/shared/execution-host'

export type SeededHostRepo = {
  id: string
  displayName: string
  /** Suffix of the repo's path; two hosts given the same one share an absolute path. */
  path?: string
  workspaces: number
  /** How long ago the newest workspace was active, in ms. */
  activityAgeMs: number
  /** Repos naming the same remote are one project across hosts. */
  remote?: string
}

export type SeededHost = {
  connectionId: string
  label: string
  repos: SeededHostRepo[]
}

export type PairedHostSidebarSeed = {
  local: SeededHostRepo[]
  hosts: SeededHost[]
  /** A host filter; null draws every host, as the default view does. */
  visibleHostIds: ExecutionHostId[] | null
  sidebarWidth: number
}

export function sshHostId(connectionId: string): ExecutionHostId {
  return `ssh:${connectionId}`
}

export async function seedPairedHostSidebar(
  page: Page,
  seed: PairedHostSidebarSeed
): Promise<void> {
  await page.evaluate((input) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    const sourceRepo = state.repos[0]
    const sourceWorktree = sourceRepo ? (state.worktreesByRepo[sourceRepo.id] ?? [])[0] : undefined
    if (!sourceRepo || !sourceWorktree) {
      throw new Error('The paired-host sidebar fixture needs the seeded repo')
    }
    const repos = [...state.repos]
    const worktreesByRepo = { ...state.worktreesByRepo }
    const now = Date.now()
    const addRepo = (repo: SeededHostRepo, connectionId: string | null): void => {
      const hostId: ExecutionHostId = connectionId ? `ssh:${connectionId}` : 'local'
      repos.push({
        ...sourceRepo,
        id: repo.id,
        path: `${sourceRepo.path}-${repo.path ?? repo.id}`,
        displayName: repo.displayName,
        upstream: undefined,
        gitRemoteIdentity: repo.remote
          ? {
              canonicalKey: `github.com/e2e/${repo.remote}`,
              remoteName: 'origin',
              remoteUrl: `https://github.com/e2e/${repo.remote}.git`
            }
          : null,
        ...(connectionId ? { connectionId, executionHostId: hostId } : {})
      })
      worktreesByRepo[repo.id] = Array.from({ length: repo.workspaces }, (_, n) => ({
        ...sourceWorktree,
        id: `${repo.id}-wt-${n}`,
        repoId: repo.id,
        path: `${sourceWorktree.path}-${repo.id}-${n}`,
        displayName: n === 0 ? 'main' : `feature-${n}`,
        branch: n === 0 ? 'refs/heads/main' : `refs/heads/feature-${n}`,
        isMainWorktree: n === 0,
        isArchived: false,
        isPinned: false,
        hostId,
        lastActivityAt: now - repo.activityAgeMs - n * 60_000
      }))
    }
    for (const repo of input.local) {
      addRepo(repo, null)
    }
    const sshTargetLabels = new Map(state.sshTargetLabels)
    for (const host of input.hosts) {
      sshTargetLabels.set(host.connectionId, host.label)
      for (const repo of host.repos) {
        addRepo(repo, host.connectionId)
      }
    }
    store.setState({ repos, worktreesByRepo, sshTargetLabels })
    const next = store.getState()
    next.setActiveView('terminal')
    next.setSidebarOpen(true)
    next.setSidebarWidth(input.sidebarWidth)
    next.setRightSidebarOpen(false)
    next.setGroupBy('repo')
    next.setFilterRepoIds([])
    next.setVisibleWorkspaceHostIds(input.visibleHostIds)
  }, seed)
}

/** Sets a seeded host's connection state directly, so no SSH action or reconnect runs. */
export async function setSeededHostConnection(
  page: Page,
  connectionId: string,
  status: 'connected' | 'disconnected'
): Promise<void> {
  await page.evaluate(
    ({ id, nextStatus }) => {
      const store = window.__store!
      const sshConnectionStates = new Map(store.getState().sshConnectionStates)
      sshConnectionStates.set(id, {
        targetId: id,
        status: nextStatus,
        error: null,
        reconnectAttempt: 0
      })
      store.setState({ sshConnectionStates })
    },
    { id: connectionId, nextStatus: status }
  )
}
