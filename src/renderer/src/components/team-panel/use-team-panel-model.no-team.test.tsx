// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamPanelSoloModel } from '../../../../shared/team-panel-model-types'

const subscribe = vi.fn(() => () => {})
vi.mock('./team-panel-model-poll', () => ({
  createTeamPanelModelPoller: () => ({ subscribe })
}))
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        activeWorkspaceExecutionHostId: null,
        activeWorktreeId: null,
        getKnownWorktreeById: () => null,
        repos: [],
        worktreesByRepo: {}
      }),
    { getState: () => ({}) }
  )
}))

const solo: TeamPanelSoloModel = {
  kind: 'solo',
  selectedPaneKey: null,
  rows: [],
  inbox: { kind: 'ready', value: { forYou: 0, waiting: 0, threads: 0, answered: 0 } },
  prs: null,
  queue: null,
  machines: null
}
const useTeamPanelSoloModel = vi.fn((active: boolean) => (active ? solo : null))
vi.mock('./use-team-panel-solo-model', () => ({
  useTeamPanelSoloModel: (active: boolean) => useTeamPanelSoloModel(active)
}))

const { useTeamPanelModel } = await import('./use-team-panel-model')

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
})

describe('Team model without a team', () => {
  it('reads the no-team view from agent status when no workspace scopes a game', async () => {
    let seen: unknown = null
    const root = createRoot(document.createElement('div'))
    roots.push(root)
    await act(async () =>
      root.render(
        (() => {
          const Probe = (): null => {
            seen = useTeamPanelModel().section
            return null
          }
          return <Probe />
        })()
      )
    )

    expect(subscribe).not.toHaveBeenCalled()
    expect(useTeamPanelSoloModel).toHaveBeenCalledWith(true)
    expect(seen).toEqual({ kind: 'ready', value: solo })
  })
})
