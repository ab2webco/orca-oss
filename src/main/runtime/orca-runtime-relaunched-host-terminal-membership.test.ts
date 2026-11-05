import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import { OrcaRuntimeService } from './orca-runtime'

// Why: a host with a live window skips the headless hydrate, so only the renderer's publication can list its tabs.
vi.mock('electron', () => ({
  BrowserWindow: {
    fromId: () => ({
      isDestroyed: () => false,
      webContents: { send: vi.fn(), isDestroyed: () => false }
    })
  }
}))

const WORKTREE_ID = 'repo::/worktree'
const REPO_ID = 'repo'
const FIRST_LEAF = '11111111-1111-4111-8111-111111111111'
const SECOND_LEAF = '22222222-2222-4222-8222-222222222222'

function leafLayout(leafId: string, ptyId: string) {
  return {
    root: { type: 'leaf' as const, leafId },
    activeLeafId: leafId,
    expandedLeafId: null,
    ptyIdsByLeafId: { [leafId]: ptyId }
  }
}

function persistedTab(id: string, ptyId: string, sortOrder: number) {
  return {
    id,
    ptyId,
    worktreeId: WORKTREE_ID,
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder,
    createdAt: 1
  }
}

function relaunchedHostSession(): WorkspaceSessionState {
  return {
    ...getDefaultWorkspaceSession(),
    tabsByWorktree: {
      [WORKTREE_ID]: [
        persistedTab('first', 'pty-first', 0),
        persistedTab('second', 'pty-second', 1)
      ]
    },
    terminalLayoutsByTabId: {
      first: leafLayout(FIRST_LEAF, 'pty-first'),
      second: leafLayout(SECOND_LEAF, 'pty-second')
    },
    terminalTopologyRevisionByRepoId: { [REPO_ID]: 1 }
  }
}

function createRuntime(session: WorkspaceSessionState): OrcaRuntimeService {
  const runtime = new OrcaRuntimeService({
    getRepos: () => [
      { id: REPO_ID, path: '/worktree', displayName: 'repo', badgeColor: 'blue', addedAt: 1 }
    ],
    getWorkspaceSession: () => session
  } as never)
  runtime.attachWindow(1)
  return runtime
}

function publishRestoredTerminals(runtime: OrcaRuntimeService): void {
  const surface = (parentTabId: string, leafId: string, ptyId: string, isActive: boolean) => ({
    type: 'terminal' as const,
    id: `${parentTabId}::${leafId}`,
    parentTabId,
    leafId,
    ptyId,
    title: 'Terminal',
    parentLayout: leafLayout(leafId, ptyId),
    isActive
  })
  runtime.syncWindowGraph(1, {
    tabs: [],
    leaves: [],
    mobileSessionTabs: [
      {
        worktree: WORKTREE_ID,
        publicationEpoch: 'renderer:relaunched',
        snapshotVersion: 1,
        activeGroupId: 'group',
        activeTabId: `first::${FIRST_LEAF}`,
        activeTabType: 'terminal',
        tabGroups: [{ id: 'group', activeTabId: 'first', tabOrder: ['first', 'second'] }],
        tabs: [
          surface('first', FIRST_LEAF, 'pty-first', true),
          surface('second', SECOND_LEAF, 'pty-second', false)
        ]
      }
    ]
  })
}

describe('relaunched host terminal membership (ORCA-946)', () => {
  it('publishes persisted surfaces whose daemon PTYs are not reattached yet', async () => {
    const runtime = createRuntime(relaunchedHostSession())

    // Why: an inactive worktree's PTYs stay in the daemon until something activates them.
    publishRestoredTerminals(runtime)

    const listed = await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)
    expect(listed.tabs.map((tab) => tab.id)).toEqual([
      `first::${FIRST_LEAF}`,
      `second::${SECOND_LEAF}`
    ])
    expect(listed.tabs.map((tab) => tab.type === 'terminal' && tab.status)).toEqual([
      'pending-handle',
      'pending-handle'
    ])
  })

  it('still fences a persisted surface that carries a retirement tombstone', async () => {
    const session = relaunchedHostSession()
    session.terminalSurfaceTombstonesByPaneKey = {
      [`first:${FIRST_LEAF}`]: {
        worktreeId: WORKTREE_ID,
        parentTabId: 'first',
        leafId: FIRST_LEAF,
        ptyId: 'pty-first',
        incarnationId: 'incarnation-first',
        retiredAt: 42
      }
    }
    const runtime = createRuntime(session)

    publishRestoredTerminals(runtime)

    const listed = await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)
    expect(listed.tabs.map((tab) => tab.id)).toEqual([`second::${SECOND_LEAF}`])
  })

  it('still fences a surface the persisted session does not list', async () => {
    const session = relaunchedHostSession()
    session.tabsByWorktree[WORKTREE_ID] = [persistedTab('second', 'pty-second', 1)]
    delete session.terminalLayoutsByTabId.first
    const runtime = createRuntime(session)

    publishRestoredTerminals(runtime)

    const listed = await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)
    expect(listed.tabs.map((tab) => tab.id)).toEqual([`second::${SECOND_LEAF}`])
  })
})
