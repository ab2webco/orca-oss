// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Repo, Worktree } from '../../../../shared/types'
import { SidebarSoloHoverContent } from './SidebarSoloHoverContent'

const mocks = vi.hoisted(() => ({
  state: {
    agentStatusByPaneKey: {} as Record<string, unknown>,
    tabsByWorktree: {},
    worktreesByRepo: {},
    repos: [],
    settings: { promptCacheTimerEnabled: false, promptCacheTtlMs: 0 },
    cacheTimerByKey: {},
    hostedReviewCache: {},
    workspacePortScan: null,
    claudeAccountRoster: null,
    folderWorkspaces: [],
    runtimeEnvironments: [],
    sshTargetLabels: new Map(),
    sshConnectionStates: new Map(),
    terminalLayoutsByTabId: {}
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))

const WORKTREE = {
  id: 'wt-1',
  repoId: 'repo-1',
  path: '/repo/cin-1145',
  displayName: 'cin-1145',
  comment: '',
  isMainWorktree: false
} as Worktree
const REPO = { id: 'repo-1', path: '/repo', displayName: 'cineco-orchestrator' } as Repo

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(paneKey: string): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() =>
    root?.render(<SidebarSoloHoverContent worktree={WORKTREE} repo={REPO} paneKey={paneKey} />)
  )
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('SidebarSoloHoverContent', () => {
  it("reads the pane's live status into V30's solo card", () => {
    mocks.state.agentStatusByPaneKey = {
      'tab-1:leaf-1': {
        state: 'working',
        prompt: 'Add booking validation',
        toolName: 'Bash',
        toolInput: 'gh pr checks 912',
        updatedAt: 1,
        stateStartedAt: 1,
        paneKey: 'tab-1:leaf-1',
        stateHistory: []
      }
    }
    const el = render('tab-1:leaf-1')
    expect(el.querySelector('[data-solo-hover-title]')?.textContent).toBe('cin-1145')
    expect(el.querySelector('[data-solo-hover-subtitle]')?.textContent).toBe('cineco-orchestrator')
    expect(el.textContent).toContain('Add booking validation')
    expect(el.textContent).toContain('gh pr checks 912')
  })

  it('draws nothing once the pane has no status', () => {
    mocks.state.agentStatusByPaneKey = {}
    expect(render('tab-1:leaf-1').querySelector('[data-sidebar-solo-hover]')).toBeNull()
  })
})
