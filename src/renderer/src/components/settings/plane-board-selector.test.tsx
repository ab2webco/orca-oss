// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlaneProject, PlaneWorkspace } from '../../../../shared/plane-types'
import { PlaneBoardSelector } from './plane-board-selector'

type StoreState = {
  settings: { defaultPlaneSelection: { workspaceSlug: string; projectId: string } | null }
  updateSettings: (updates: Record<string, unknown>) => Promise<void>
  listPlaneProjects: (workspaceId?: string | null) => Promise<PlaneProject[]>
  getCachedPlaneProjects: (workspaceId?: string | null) => PlaneProject[] | null
}

const mocks = vi.hoisted(() => ({
  store: { current: null as StoreState | null }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: StoreState) => unknown) => {
    if (!mocks.store.current) {
      throw new Error('Store state was not installed')
    }
    return selector(mocks.store.current)
  }
}))

const workspaces: PlaneWorkspace[] = [
  { id: 'ws-1', baseUrl: 'https://api.plane.so', workspaceSlug: 'acme', displayName: 'Acme' },
  { id: 'ws-2', baseUrl: 'https://api.plane.so', workspaceSlug: 'beta', displayName: 'Beta' }
]

const projectsByWorkspace: Record<string, PlaneProject[]> = {
  'ws-1': [{ id: 'proj-1', identifier: 'ACM', name: 'Acme Roadmap' }],
  'ws-2': [{ id: 'proj-2', identifier: 'BET', name: 'Beta Launch' }]
}

function installStore(
  defaultPlaneSelection: StoreState['settings']['defaultPlaneSelection'],
  updateSettings: StoreState['updateSettings'] = vi.fn(async () => {})
): StoreState {
  const state: StoreState = {
    settings: { defaultPlaneSelection },
    updateSettings,
    listPlaneProjects: vi.fn(async (workspaceId) => projectsByWorkspace[workspaceId ?? ''] ?? []),
    getCachedPlaneProjects: vi.fn(() => null)
  }
  mocks.store.current = state
  return state
}

describe('PlaneBoardSelector', () => {
  afterEach(() => {
    cleanup()
    mocks.store.current = null
  })

  it('renders nothing when there are no connected workspaces', () => {
    installStore(null)
    const { container } = render(<PlaneBoardSelector workspaces={[]} />)
    expect(container.textContent).toBe('')
  })

  it('persists defaultPlaneSelection when a workspace and project are chosen', async () => {
    const user = userEvent.setup()
    const updateSettings = vi.fn(async () => {})
    installStore(null, updateSettings)
    render(<PlaneBoardSelector workspaces={workspaces} />)

    await user.click(screen.getByRole('combobox', { name: 'Plane workspace' }))
    await user.click(screen.getByRole('option', { name: 'Beta' }))

    await user.click(screen.getByRole('combobox', { name: 'Plane project' }))
    await user.click(screen.getByRole('option', { name: 'Beta Launch' }))

    expect(updateSettings).toHaveBeenCalledWith({
      defaultPlaneSelection: { workspaceSlug: 'beta', projectId: 'proj-2' }
    })
  })

  it('preselects the persisted workspace and project on mount', async () => {
    installStore({ workspaceSlug: 'beta', projectId: 'proj-2' })
    render(<PlaneBoardSelector workspaces={workspaces} />)

    expect(await screen.findByRole('combobox', { name: 'Plane workspace' })).toHaveTextContent(
      'Beta'
    )
    expect(await screen.findByRole('combobox', { name: 'Plane project' })).toHaveTextContent(
      'Beta Launch'
    )
  })

  it('applies the supplied className to the root instead of the default stacked spacing', () => {
    installStore(null)
    const { container } = render(
      <PlaneBoardSelector workspaces={workspaces} className="custom-row-class" />
    )
    expect(container.firstElementChild).toHaveClass('custom-row-class')
    expect(container.firstElementChild).not.toHaveClass('space-y-2')
  })
})
