// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type State = {
  activeWorktreeId: string | null
  persistedUIReady: boolean
  rightSidebarTab: string
  rightSidebarOpen: boolean
  sidebarOpen: boolean
  sidebarWidth: number
  rightSidebarWidth: number
  activityBarPosition: string
  getKnownWorktreeById: (id: string) => { repoId: string } | undefined
  setRightSidebarTab: (tab: string) => void
  setRightSidebarOpen: (open: boolean) => void
}
const repoOf: Record<string, string> = { 'wt-1': 'repo-a', 'wt-2': 'repo-a', 'wt-9': 'repo-b' }
let state: State
let listener: ((next: State, prev: State) => void) | null = null
vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (s: State) => unknown) => selector(state), {
    getState: () => state,
    subscribe: (one: (next: State, prev: State) => void) => {
      listener = one
      return () => void (listener = null)
    }
  })
}))
let kind: 'team' | 'solo' | null = null
vi.mock('./use-team-panel-model', () => ({ useTeamPanelKind: () => kind }))

const { TeamTabAutoOpen } = await import('./TeamTabAutoOpen')
const { openTeamTabOnLeadStart, resetTeamTabDefaultedForTests } =
  await import('./team-tab-auto-open')

let stored: Record<string, unknown>
const set = vi.fn(async (patch: Record<string, unknown>) => void Object.assign(stored, patch))
let leadStarted: ((worktreeId: string) => void) | null
let root: Root | null = null

beforeEach(() => {
  window.innerWidth = 1440
  resetTeamTabDefaultedForTests()
  stored = {}
  set.mockClear()
  leadStarted = null
  kind = null
  state = {
    activeWorktreeId: 'wt-1',
    persistedUIReady: true,
    rightSidebarTab: 'explorer',
    rightSidebarOpen: false,
    sidebarOpen: true,
    sidebarWidth: 280,
    rightSidebarWidth: 350,
    activityBarPosition: 'top',
    getKnownWorktreeById: (id) => (repoOf[id] ? { repoId: repoOf[id] } : undefined),
    setRightSidebarTab: (tab) => void (state.rightSidebarTab = tab),
    setRightSidebarOpen: (open) => void (state.rightSidebarOpen = open)
  }
  Object.assign(window, {
    api: {
      ui: { get: async () => ({ ...stored }), set },
      runtime: {
        onGameLeadStarted: (callback: (worktreeId: string) => void) => {
          leadStarted = callback
          return () => void (leadStarted = null)
        }
      }
    }
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
})

async function mount(): Promise<void> {
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<TeamTabAutoOpen />))
}

describe('Team tab on a lead start (ORCA-1414)', () => {
  it('opens the right sidebar on Team where the lead worktree is shown', async () => {
    await mount()

    act(() => leadStarted?.('wt-1'))

    expect(state).toMatchObject({ rightSidebarTab: 'team', rightSidebarOpen: true })
  })

  it("opens it from another worktree of the lead's project", () => {
    openTeamTabOnLeadStart('wt-2')

    expect(state).toMatchObject({ rightSidebarTab: 'team', rightSidebarOpen: true })
  })

  it('does not open where the sidebar would overlay the left sidebar and content', () => {
    // 280 + 350 + 120 > 700: the sidebar would float over the content instead of docking.
    window.innerWidth = 700
    openTeamTabOnLeadStart('wt-1')
    expect(state).toMatchObject({ rightSidebarOpen: false, rightSidebarTab: 'explorer' })
    window.innerWidth = 1440
    openTeamTabOnLeadStart('wt-1')
    expect(state).toMatchObject({ rightSidebarOpen: true, rightSidebarTab: 'team' })
  })

  it('leaves the sidebar alone when another project is shown', () => {
    openTeamTabOnLeadStart('wt-9')

    expect(state).toMatchObject({ rightSidebarTab: 'explorer', rightSidebarOpen: false })
  })
})

describe('Team as the first tab of a team project (ORCA-1414)', () => {
  it('picks Team once, without opening a closed sidebar, and records it', async () => {
    kind = 'team'
    await mount()

    expect(state).toMatchObject({ rightSidebarTab: 'team', rightSidebarOpen: false })
    expect(stored).toEqual({ _rightSidebarTeamTabDefaulted: true })
  })

  it('keeps the tab a later session finds already defaulted', async () => {
    stored = { _rightSidebarTeamTabDefaulted: true }
    kind = 'team'
    await mount()

    expect(state.rightSidebarTab).toBe('explorer')
  })

  it('keeps a tab the person picked before the team showed', async () => {
    await mount()
    const prev = { ...state }
    state.rightSidebarTab = 'source-control'
    act(() => listener?.(state, prev))
    kind = 'team'
    await act(async () => root?.render(<TeamTabAutoOpen />))

    expect(state.rightSidebarTab).toBe('source-control')
    expect(stored).toEqual({ _rightSidebarTeamTabDefaulted: true })
  })

  it('does not count the hydration that restores the stored tab as a pick', async () => {
    await mount()
    const prev = { ...state, persistedUIReady: false }
    act(() => listener?.(state, prev))
    kind = 'team'
    await act(async () => root?.render(<TeamTabAutoOpen />))

    expect(state.rightSidebarTab).toBe('team')
  })

  it('does nothing for a project with no team', async () => {
    kind = 'solo'
    await mount()

    expect(state.rightSidebarTab).toBe('explorer')
    expect(set).not.toHaveBeenCalled()
  })
})
