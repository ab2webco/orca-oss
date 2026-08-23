import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'

const REPO_ID = 'repo-1'
const WORKTREE_PATH = '/tmp/orca-live-pty-worktree'
const WORKTREE_ID = `${REPO_ID}::${WORKTREE_PATH}`
const OTHER_WORKTREE_PATH = '/tmp/orca-other-worktree'
const OTHER_WORKTREE_ID = `${REPO_ID}::${OTHER_WORKTREE_PATH}`
const TAB_ID = '11111111-1111-4111-8111-111111111111'
const LEAF_ID = '22222222-2222-4222-8222-222222222222'

function makeStore() {
  const repo = {
    id: REPO_ID,
    path: '/tmp/orca-repo',
    displayName: 'orca-repo',
    badgeColor: 'blue',
    addedAt: 1
  }
  return {
    getRepo: vi.fn((id: string) => (id === REPO_ID ? repo : undefined)),
    getRepos: vi.fn(() => [repo]),
    getAllWorktreeMeta: vi.fn(() => ({})),
    getWorktreeMeta: vi.fn(() => undefined),
    getSettings: vi.fn(() => ({ workspaceDir: '/tmp/workspaces' }))
  }
}

describe('terminal list/split worktree resolution authority', () => {
  it('keeps a listed live PTY actionable when the split catalog omits its target worktree', async () => {
    const spawn = vi.fn(async () => ({ id: 'pty-split' }))
    const revealTerminalSession = vi.fn(async () => ({ tabId: TAB_ID }))
    const runtime = new OrcaRuntimeService(makeStore() as never)
    runtime.setPtyController({
      spawn,
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })
    runtime.setNotifier({
      worktreesChanged: vi.fn(),
      reposChanged: vi.fn(),
      activateWorktree: vi.fn(),
      createTerminal: vi.fn(),
      revealTerminalSession,
      splitTerminal: vi.fn(),
      renameTerminal: vi.fn(),
      focusTerminal: vi.fn(),
      closeTerminal: vi.fn(),
      sleepWorktree: vi.fn(),
      terminalFitOverrideChanged: vi.fn(),
      terminalDriverChanged: vi.fn()
    })
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
    runtime.registerPty('pty-source', WORKTREE_ID, null, { tabId: TAB_ID, leafId: LEAF_ID })
    const internals = runtime as unknown as {
      listResolvedWorktrees: () => Promise<unknown[]>
    }
    vi.spyOn(internals, 'listResolvedWorktrees').mockResolvedValue([
      {
        id: OTHER_WORKTREE_ID,
        path: OTHER_WORKTREE_PATH,
        repoId: REPO_ID,
        branch: 'other'
      }
    ])

    const [listed] = (await runtime.listTerminals(`id:${WORKTREE_ID}`)).terminals
    expect(listed).toMatchObject({
      ptyId: 'pty-source',
      worktreeId: WORKTREE_ID,
      connected: true
    })

    await expect(runtime.splitTerminal(listed.handle)).resolves.toMatchObject({
      handle: expect.stringMatching(/^term_/),
      tabId: TAB_ID
    })
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: WORKTREE_PATH, connectionId: null, worktreeId: WORKTREE_ID })
    )
    expect(revealTerminalSession).toHaveBeenCalledWith(
      WORKTREE_ID,
      expect.objectContaining({ ptyId: 'pty-split', splitFromLeafId: LEAF_ID })
    )
  })
})
