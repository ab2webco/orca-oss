import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateWorktreeResult } from '../../shared/worktree/create-types'
import {
  listWorktreesMock,
  addWorktreeMock,
  getEffectiveHooksMock,
  getEffectiveHooksFromConfigMock,
  shouldRunSetupForCreateMock,
  loadHooksMock,
  getSshGitProviderMock,
  getSshFilesystemProviderMock,
  getActiveMultiplexerMock
} from './worktrees-test-module-mocks'
import { handlers, setupWorktreeHandlers, store } from './worktrees-test-harness'

const { createLocalProbeMock } = vi.hoisted(() => ({ createLocalProbeMock: vi.fn() }))

vi.mock('../git/worktree-hooks-path-check', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLocalWorktreeHooksPathProbe: createLocalProbeMock
}))
vi.mock('electron', async () =>
  (await import('./worktrees-test-module-mocks')).electronModuleMock()
)
vi.mock('../git/worktree', async () =>
  (await import('./worktrees-test-module-mocks')).gitWorktreeModuleMock()
)
vi.mock('../git/runner', async () =>
  (await import('./worktrees-test-module-mocks')).gitRunnerModuleMock()
)
vi.mock('../git/repo', async () =>
  (await import('./worktrees-test-module-mocks')).gitRepoModuleMock()
)
vi.mock('../git/git-username', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveLocalGitUsername: (await import('./worktrees-test-module-mocks'))
    .resolveLocalGitUsernameMock
}))
vi.mock('../github/client', async () =>
  (await import('./worktrees-test-module-mocks')).githubClientModuleMock()
)
vi.mock('../source-control/hosted-review', async () =>
  (await import('./worktrees-test-module-mocks')).hostedReviewModuleMock()
)
vi.mock('../providers/ssh-git-dispatch', async () =>
  (await import('./worktrees-test-module-mocks')).sshGitDispatchModuleMock()
)
vi.mock('../providers/ssh-filesystem-dispatch', async () =>
  (await import('./worktrees-test-module-mocks')).sshFilesystemDispatchModuleMock()
)
vi.mock('./worktree-symlinks', async () =>
  (await import('./worktrees-test-module-mocks')).worktreeSymlinksModuleMock()
)
vi.mock('./ssh', async () => (await import('./worktrees-test-module-mocks')).sshModuleMock())
vi.mock('../hooks', async () => (await import('./worktrees-test-module-mocks')).hooksModuleMock())
vi.mock('../setup-runner-script-text', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).setupRunnerScriptTextModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../worktree-runner-script', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).worktreeRunnerScriptModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../effective-hook-config', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).effectiveHookConfigModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../setup-hook-env-vars', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).setupHookEnvVarsModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('./worktree-logic', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).worktreeLogicModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../terminal-history-deletion', async () =>
  (await import('./worktrees-test-module-mocks')).terminalHistoryDeletionModuleMock()
)
vi.mock('../ports/advertised-url-watcher', async () =>
  (await import('./worktrees-test-module-mocks')).advertisedUrlWatcherModuleMock()
)
vi.mock('../workspace-cleanup-scan-snapshot', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceCleanupScanSnapshotModuleMock()
)
vi.mock('../workspace-space-analysis-snapshot', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceSpaceAnalysisSnapshotModuleMock()
)
vi.mock('../workspace-cleanup-removal-snapshot-prune', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceCleanupRemovalSnapshotPruneModuleMock()
)
vi.mock('../runtime/worktree-teardown', async () =>
  (await import('./worktrees-test-module-mocks')).worktreeTeardownModuleMock()
)
vi.mock('./pty', async () => (await import('./worktrees-test-module-mocks')).ptyModuleMock())

function probeWithShippedHusky(worktreePath: string): {
  readHooksPath: () => Promise<string>
  pathExists: (path: string) => Promise<boolean>
} {
  return {
    readHooksPath: async () => '.husky/_\n',
    pathExists: async (path) => path === `${worktreePath}/.husky/pre-commit`
  }
}

describe('worktrees:create hooks path warning', () => {
  beforeEach(() => {
    setupWorktreeHandlers()
    createLocalProbeMock.mockReset()
  })

  it('returns a local warning naming the hooks dir and the shipped hook', async () => {
    addWorktreeMock.mockResolvedValue({})
    listWorktreesMock.mockResolvedValueOnce([
      {
        path: '/workspace/improve-dashboard',
        head: 'def',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    createLocalProbeMock.mockImplementation(probeWithShippedHusky)

    const result = (await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard'
    })) as CreateWorktreeResult

    expect(createLocalProbeMock).toHaveBeenCalledWith('/workspace/improve-dashboard', {})
    expect(result.warning).toContain('".husky/_"')
    expect(result.warning).toContain('".husky/pre-commit"')
    expect(result.warning).not.toMatch(/setup script may install/i)
  })

  it('mentions setup when a local setup script will launch', async () => {
    addWorktreeMock.mockResolvedValue({})
    listWorktreesMock.mockResolvedValueOnce([
      {
        path: '/workspace/improve-dashboard',
        head: 'def',
        branch: 'improve-dashboard',
        isBare: false,
        isMainWorktree: false
      }
    ])
    loadHooksMock.mockReturnValue({ scripts: { setup: 'npm install' } })
    getEffectiveHooksMock.mockReturnValue({ scripts: { setup: 'npm install' } })
    getEffectiveHooksFromConfigMock.mockReturnValue({ scripts: { setup: 'npm install' } })
    shouldRunSetupForCreateMock.mockReturnValue(true)
    createLocalProbeMock.mockImplementation(probeWithShippedHusky)

    const result = (await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'improve-dashboard'
    })) as CreateWorktreeResult

    expect(result.warning).toMatch(/setup script may install/i)
  })

  it('returns the same warning for an SSH worktree through the remote providers', async () => {
    const repo = {
      id: 'repo-ssh',
      path: '/remote/repo',
      displayName: 'ssh',
      badgeColor: '#000',
      addedAt: 0,
      connectionId: 'conn-1'
    }
    const provider = {
      exec: vi.fn().mockImplementation(async (args: string[]) => {
        if (args.join(' ') === 'rev-parse --git-path hooks') {
          return { stdout: '.husky/_\n', stderr: '' }
        }
        if (args[0] === 'remote') {
          return { stdout: 'origin\n', stderr: '' }
        }
        if (args[0] === 'symbolic-ref') {
          return { stdout: 'refs/remotes/origin/main\n', stderr: '' }
        }
        if (args[0] === 'rev-parse' && args.includes('refs/remotes/origin/main^{commit}')) {
          return { stdout: `${'a'.repeat(40)}\n`, stderr: '' }
        }
        return { stdout: '', stderr: '' }
      }),
      fetchRemoteTrackingRef: vi.fn().mockResolvedValue(undefined),
      addWorktree: vi.fn().mockResolvedValue(undefined),
      listWorktrees: vi.fn().mockResolvedValueOnce([
        {
          path: '/remote/repo-improve-dashboard',
          head: 'abc123',
          branch: 'refs/heads/improve-dashboard',
          isBare: false,
          isMainWorktree: false
        }
      ])
    }
    const missing = (): Promise<never> =>
      Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    const fsProvider = {
      stat: vi.fn(async (filePath: string) =>
        filePath === '/remote/repo-improve-dashboard/.husky/pre-commit'
          ? { size: 1, type: 'file' as const, mtime: 0 }
          : missing()
      ),
      readFile: vi.fn(missing)
    }
    store.getRepos.mockReturnValue([repo])
    store.getRepo.mockReturnValue(repo)
    store.setWorktreeMeta.mockImplementation((_worktreeId, meta) => meta)
    getSshGitProviderMock.mockReturnValue(provider)
    getSshFilesystemProviderMock.mockReturnValue(fsProvider)
    getActiveMultiplexerMock.mockReturnValue({ request: vi.fn(), notify: vi.fn() })

    const result = (await handlers['worktrees:create'](null, {
      repoId: 'repo-ssh',
      name: 'improve-dashboard'
    })) as CreateWorktreeResult

    expect(provider.exec).toHaveBeenCalledWith(
      ['rev-parse', '--git-path', 'hooks'],
      '/remote/repo-improve-dashboard',
      expect.anything()
    )
    expect(result.warning).toContain('".husky/_"')
    expect(result.warning).toContain('".husky/pre-commit"')
  })
})
