// A worktree the desktop window creates or removes goes through IPC, never through the runtime,
// so the runtime's 30 s scan cache must be told; otherwise CLI selectors miss it until expiry.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => {
  const ipcMain = {
    on: vi.fn(() => ipcMain),
    removeListener: vi.fn(() => ipcMain),
    emit: vi.fn(() => true)
  }
  return {
    BrowserWindow: { fromId: vi.fn((): unknown => null) },
    webContents: { fromId: vi.fn((): unknown => null) },
    ipcMain,
    app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
  }
})
vi.mock('electron', () => electronMocks)

const listWorktreesStrictMock = vi.hoisted(() => vi.fn())
vi.mock('../git/worktree', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listWorktreesStrict: listWorktreesStrictMock
}))

const readRepoWorktreeAdminFingerprintMock = vi.hoisted(() => vi.fn())
vi.mock('./repo-worktree-admin-fingerprint', () => ({
  readRepoWorktreeAdminFingerprint: readRepoWorktreeAdminFingerprintMock
}))

import { OrcaRuntimeService } from './orca-runtime'

const REPO_ID = 'repo-local'
const REPO_PATH = '/Users/me/dev/app'
const WORKTREE_PATH = '/Users/me/dev/app-feature'
const WORKTREE_ID = `${REPO_ID}::${WORKTREE_PATH}`

const MAIN_ROW = {
  path: REPO_PATH,
  head: 'abc',
  branch: 'main',
  isBare: false,
  isMainWorktree: true
}
const FEATURE_ROW = {
  path: WORKTREE_PATH,
  head: 'def',
  branch: 'feature',
  isBare: false,
  isMainWorktree: false
}

function makeRuntime(): OrcaRuntimeService {
  const repos = [
    { id: REPO_ID, path: REPO_PATH, displayName: 'app', badgeColor: 'blue', addedAt: 1 }
  ]
  const metaById: Record<string, Record<string, unknown>> = {}
  const store = {
    getRepo: (id: string) => repos.find((repo) => repo.id === id),
    getRepos: () => repos,
    getAllWorktreeMeta: () => metaById,
    getWorktreeMeta: (id: string) => metaById[id],
    setWorktreeMeta: (id: string, meta: Record<string, unknown>) => {
      metaById[id] = { ...metaById[id], ...meta }
      return metaById[id]
    },
    removeWorktreeMeta: () => {},
    removeWorktreeLineage: vi.fn(),
    removeWorkspaceLineage: vi.fn(),
    getAllWorktreeLineage: () => ({}),
    getAllWorkspaceLineage: () => ({}),
    getGitHubCache: () => undefined as never,
    getSettings: () => ({ workspaceDir: '/tmp/workspaces', nestWorkspaces: false }),
    getProjects: () => []
  }
  return new OrcaRuntimeService(store as never)
}

describe('worktree lifecycle reported from IPC', () => {
  beforeEach(() => {
    listWorktreesStrictMock.mockReset()
    listWorktreesStrictMock.mockResolvedValue([MAIN_ROW])
    readRepoWorktreeAdminFingerprintMock.mockReset()
    readRepoWorktreeAdminFingerprintMock.mockResolvedValue('fp-1')
  })

  it('makes a worktree created outside the runtime resolvable at once', async () => {
    const runtime = makeRuntime()
    await runtime.showManagedWorktree(`id:${REPO_ID}::${REPO_PATH}`)
    listWorktreesStrictMock.mockResolvedValue([MAIN_ROW, FEATURE_ROW])

    runtime.noteIpcWorktreeLifecycle({
      kind: 'created',
      worktreeId: WORKTREE_ID,
      path: WORKTREE_PATH,
      branch: 'feature'
    })

    await expect(runtime.showManagedWorktree(`id:${WORKTREE_ID}`)).resolves.toMatchObject({
      id: WORKTREE_ID
    })
  })

  it('stops resolving a worktree removed outside the runtime', async () => {
    listWorktreesStrictMock.mockResolvedValue([MAIN_ROW, FEATURE_ROW])
    const runtime = makeRuntime()
    await runtime.showManagedWorktree(`id:${WORKTREE_ID}`)
    listWorktreesStrictMock.mockResolvedValue([MAIN_ROW])

    runtime.noteIpcWorktreeLifecycle({
      kind: 'removed',
      worktreeId: WORKTREE_ID,
      path: WORKTREE_PATH
    })

    await expect(runtime.showManagedWorktree(`id:${WORKTREE_ID}`)).rejects.toThrow(
      'selector_not_found'
    )
  })
})
