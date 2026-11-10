// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Why the real pollers: the lead's condition is one game.state read per 20 s, which only the real
// refcounted poller can prove. Only the host reads and the model builder are stubbed.
const reads = vi.hoisted(() => ({
  leads: 0,
  state: 0,
  leadHandles: [] as string[]
}))

vi.mock('@/components/team-panel/team-panel-lead-read', () => ({
  readTeamLeads: async () => {
    reads.leads += 1
    return reads.leadHandles.map((handle) => ({ handle }))
  },
  readTeamLeadRoster: async () => ({
    leads: reads.leadHandles.map((handle) => ({ handle })),
    restoring: []
  }),
  findTeamLeadCaller: () => ({
    worktreeId: 'wt-main',
    terminalHandle: 'term-lead',
    paneKey: 'p'
  }),
  readTeamLeadState: async () => {
    reads.state += 1
    return { ok: true }
  },
  readTeamOwnerQuestions: async () => null,
  readTeamXp: async () => null
}))

const lead = {
  worktreeId: 'wt-main',
  paneKey: 'p-lead',
  host: { kind: 'local' },
  name: 'Castle'
}
const members = [
  {
    worktreeId: 'wt-m',
    paneKey: 'p-m',
    host: { kind: 'local' },
    name: 'Squire'
  }
]
vi.mock('@/components/team-panel/team-panel-model-of', () => ({
  teamPanelModelOf: () => ({
    kind: 'team',
    lead,
    members,
    inbox: { kind: 'ready', value: {} }
  })
}))
vi.mock('@/components/team-panel/use-team-panel-solo-model', () => ({
  useTeamPanelSoloModel: () => null
}))
vi.mock('@/components/team-panel/use-team-panel-look', () => ({
  useTeamPanelLook: () => 'plain'
}))

const baseState = (): Record<string, unknown> => ({
  activeWorkspaceExecutionHostId: null,
  activeWorktreeId: 'wt-main',
  getKnownWorktreeById: () => ({ repoId: 'repo-1' }),
  repos: [{ id: 'repo-1', displayName: 'orca-oss' }],
  worktreesByRepo: { 'repo-1': [{ id: 'wt-main' }, { id: 'wt-m' }] },
  runtimeEnvironments: [],
  rightSidebarOpen: true,
  rightSidebarTab: 'team',
  tabsByWorktree: {},
  ptyIdsByTabId: {},
  terminalLayoutsByTabId: {},
  agentStatusByPaneKey: {}
})
let appState = baseState()
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(appState),
    { getState: () => appState }
  )
}))

const { useTeamPanelModel } = await import('@/components/team-panel/use-team-panel-model')
const { SidebarTeamRosterSync } = await import('./SidebarTeamRosterSync')
const { useSidebarTeamRosterStore } = await import('./sidebar-team-roster')

const roots: ReturnType<typeof createRoot>[] = []
beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { runtime: {} }
  })
})
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  vi.useRealTimers()
  reads.leads = 0
  reads.state = 0
  reads.leadHandles = []
  appState = baseState()
  Reflect.deleteProperty(window, 'api')
})

function TeamPanelProbe(): null {
  useTeamPanelModel()
  return null
}

async function mount(element: React.JSX.Element): Promise<void> {
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  await act(async () => root.render(element))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

const withAgent = (): void => {
  appState = {
    ...baseState(),
    agentStatusByPaneKey: { 'tab-lead:leaf': { state: 'working' } }
  }
}

describe('SidebarTeamRosterSync', () => {
  it('shares the Team panel poller: one game.state read per 20 s with both mounted', async () => {
    withAgent()
    reads.leadHandles = ['term-lead']
    await mount(
      <>
        <TeamPanelProbe />
        <SidebarTeamRosterSync />
      </>
    )
    const first = reads.state
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })

    expect(first).toBe(1)
    expect(reads.state).toBe(2)
  })

  it('reads fresh once when the panel opens on the sidebar run, then once per 20 s', async () => {
    withAgent()
    reads.leadHandles = ['term-lead']
    await mount(<SidebarTeamRosterSync />)
    expect(reads.state).toBe(1)

    await mount(<TeamPanelProbe />)
    expect(reads.state).toBe(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(reads.state).toBe(3)
  })

  it('publishes the lead and members for the rows, with the panel closed', async () => {
    withAgent()
    reads.leadHandles = ['term-lead']
    await mount(<SidebarTeamRosterSync />)

    expect(useSidebarTeamRosterStore.getState().model).toEqual({
      lead,
      members
    })
    expect(useSidebarTeamRosterStore.getState().look).toBe('plain')
  })

  it('reads no game.state when no lead is live', async () => {
    withAgent()
    await mount(<SidebarTeamRosterSync />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000)
    })

    expect(reads.leads).toBeGreaterThan(0)
    expect(reads.state).toBe(0)
    expect(useSidebarTeamRosterStore.getState().model).toBeNull()
  })

  it('reads nothing at all while no agent runs', async () => {
    await mount(<SidebarTeamRosterSync />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000)
    })

    expect(reads.leads).toBe(0)
    expect(reads.state).toBe(0)
  })
})
