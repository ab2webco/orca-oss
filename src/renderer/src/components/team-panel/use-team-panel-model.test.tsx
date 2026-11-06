// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamMemberCard, TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import type { TeamPanelModelSource } from './use-team-panel-model'

const subscribe = vi.fn(() => () => {})
let publish: (source: TeamPanelModelSource) => void = () => {}
vi.mock('./team-panel-model-poll', () => ({
  createTeamPanelModelPoller: (deps: { publish: typeof publish }) => {
    publish = deps.publish
    return { subscribe }
  }
}))
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        activeWorkspaceExecutionHostId: null,
        activeWorktreeId: 'wt',
        getKnownWorktreeById: () => ({ repoId: 'repo-1' }),
        repos: [{ id: 'repo-1', displayName: 'orca-oss' }],
        worktreesByRepo: { 'repo-1': [{ id: 'wt' }] }
      }),
    { getState: () => ({}) }
  )
}))

const { useTeamMemberOfTab, useTeamPanelKind, useTeamPanelModel } =
  await import('./use-team-panel-model')

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  subscribe.mockClear()
})

async function mount(Probe: () => null): Promise<void> {
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  await act(async () => root.render(<Probe />))
}

describe('Team model polling', () => {
  it('polls only for the open panel', async () => {
    await mount(() => {
      useTeamPanelModel()
      return null
    })

    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  // Why: the activity bar is always mounted; polling game.state for it would run with the panel closed.
  it('reads the last kind for the activity bar without polling', async () => {
    await mount(() => {
      useTeamPanelKind()
      return null
    })

    expect(subscribe).not.toHaveBeenCalled()
  })
})

const LEAF = '7f3c1e2a-4b5d-4c6e-8f90-a1b2c3d4e5f6'
const card = (name: string, host: TeamMemberCard['host']): TeamMemberCard =>
  ({ name, paneKey: `tab-7:${LEAF}`, host }) as TeamMemberCard

describe('useTeamMemberOfTab', () => {
  it("finds the local member whose pane is in the tab, never a paired host's same tab id", async () => {
    const remote = card('Squire', {
      kind: 'remote',
      name: 'mini',
      environmentId: 'e',
      reachable: true
    })
    const local = card('Knight', { kind: 'local' })
    publish({
      section: {
        kind: 'ready',
        value: { kind: 'team', members: [remote, local] } as unknown as TeamPanelGameModel
      },
      retry: null
    })
    const seen: (string | null)[] = []

    await mount(() => {
      seen.push(
        useTeamMemberOfTab('tab-7')?.name ?? null,
        useTeamMemberOfTab('tab-8')?.name ?? null
      )
      return null
    })

    expect(seen.slice(-2)).toEqual(['Knight', null])
    expect(subscribe).not.toHaveBeenCalled()
  })
})
