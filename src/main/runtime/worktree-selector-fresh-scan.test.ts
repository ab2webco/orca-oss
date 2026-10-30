import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn(), emit: vi.fn(() => true) },
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
}))

const scanLocalRepoWorktreesForResolution = vi.hoisted(() => vi.fn())
vi.mock('./repo-worktree-resolution-scan', () => ({
  scanLocalRepoWorktreesForResolution
}))

const readRepoWorktreeAdminFingerprint = vi.hoisted(() => vi.fn())
vi.mock('./repo-worktree-admin-fingerprint', () => ({
  readRepoWorktreeAdminFingerprint
}))

const getSshGitProvider = vi.hoisted(() => vi.fn())
vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProvider,
  getSshGitProviderGeneration: vi.fn(() => 0),
  requireSshGitProvider: (connectionId: string) => getSshGitProvider(connectionId)
}))

import type { GitWorktreeInfo } from '../../shared/worktree/types'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import { OrcaRuntimeService } from './orca-runtime'

const REPO_PATH = '/repo'
const KNOWN_PATH = '/repo/known'
const FRESH_PATH = '/repo/fresh'

function row(path: string, branch: string): GitWorktreeInfo {
  return { path, head: 'abc', branch, isBare: false, isMainWorktree: false }
}

function makeStore(repo: Repo) {
  const meta: Record<string, WorktreeMeta> = {}
  return {
    getRepo: (id: string) => (id === repo.id ? repo : undefined),
    getRepos: () => [repo],
    getAllWorktreeMeta: () => meta,
    getWorktreeMeta: (id: string) => meta[id],
    setWorktreeMeta: (id: string, patch: Partial<WorktreeMeta>) => {
      meta[id] = { ...meta[id], ...patch } as WorktreeMeta
      return meta[id]
    },
    getAllWorktreeLineage: () => ({}),
    getAllWorkspaceLineage: () => ({}),
    removeWorktreeLineage: vi.fn(),
    removeWorkspaceLineage: vi.fn(),
    getGitHubCache: () => undefined,
    getSettings: () => ({
      workspaceDir: '/tmp/workspaces',
      branchPrefix: 'none'
    }),
    getProjects: () => [],
    getFolderWorkspaces: () => [],
    getProjectGroups: () => []
  }
}

const localRepo = {
  id: 'repo-1',
  path: REPO_PATH,
  displayName: 'App',
  badgeColor: 'blue',
  addedAt: 1
} satisfies Repo

// ORCA-865: a worktree added on the host outside this runtime stayed `selector_not_found` until the scan TTL lapsed.
describe('a worktree added after the catalog was scanned', () => {
  beforeEach(() => {
    scanLocalRepoWorktreesForResolution.mockReset()
    readRepoWorktreeAdminFingerprint.mockReset()
    getSshGitProvider.mockReset()
  })

  it('resolves by path on the first try instead of waiting for the scan cache to expire', async () => {
    scanLocalRepoWorktreesForResolution
      .mockResolvedValueOnce({
        ok: true,
        worktrees: [row(KNOWN_PATH, 'known')]
      })
      .mockResolvedValue({
        ok: true,
        worktrees: [row(KNOWN_PATH, 'known'), row(FRESH_PATH, 'fresh')]
      })
    readRepoWorktreeAdminFingerprint
      .mockResolvedValueOnce('before-add')
      .mockResolvedValue('after-add')
    const runtime = new OrcaRuntimeService(makeStore(localRepo) as never)

    await expect(runtime.showManagedTerminalWorkspace(`path:${KNOWN_PATH}`)).resolves.toBeTruthy()
    await expect(runtime.showManagedTerminalWorkspace(`path:${FRESH_PATH}`)).resolves.toMatchObject(
      {
        id: `${localRepo.id}::${FRESH_PATH}`,
        path: FRESH_PATH
      }
    )
  })

  it('resolves a worktree added on an SSH host the same way', async () => {
    const listWorktrees = vi
      .fn()
      .mockResolvedValueOnce([row(KNOWN_PATH, 'known')])
      .mockResolvedValue([row(KNOWN_PATH, 'known'), row(FRESH_PATH, 'fresh')])
    getSshGitProvider.mockReturnValue({ listWorktrees })
    const sshRepo = { ...localRepo, connectionId: 'ssh-1' } satisfies Repo
    const runtime = new OrcaRuntimeService(makeStore(sshRepo) as never)

    await expect(runtime.showManagedTerminalWorkspace(`path:${KNOWN_PATH}`)).resolves.toBeTruthy()
    await expect(runtime.showManagedTerminalWorkspace(`branch:fresh`)).resolves.toMatchObject({
      path: FRESH_PATH
    })
  })

  it('rechecks once and still reports a worktree that does not exist', async () => {
    scanLocalRepoWorktreesForResolution.mockResolvedValue({
      ok: true,
      worktrees: [row(KNOWN_PATH, 'known')]
    })
    readRepoWorktreeAdminFingerprint.mockResolvedValue('unchanged')
    const runtime = new OrcaRuntimeService(makeStore(localRepo) as never)

    await expect(runtime.showManagedTerminalWorkspace(`path:${KNOWN_PATH}`)).resolves.toBeTruthy()
    await expect(runtime.showManagedTerminalWorkspace('path:/repo/missing')).rejects.toThrow(
      'selector_not_found'
    )
    // Why: an unchanged Git admin fingerprint proves nothing was added, so the recheck spawns no `git worktree list`.
    expect(scanLocalRepoWorktreesForResolution).toHaveBeenCalledOnce()
  })
})
