// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const subscribe = vi.fn(() => () => {})
vi.mock('./team-panel-model-poll', () => ({
  createTeamPanelModelPoller: () => ({ subscribe })
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

const { useTeamPanelKind, useTeamPanelModel } = await import('./use-team-panel-model')

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
