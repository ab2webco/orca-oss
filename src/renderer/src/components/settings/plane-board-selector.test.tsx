// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

let root: Root | null = null
let container: HTMLDivElement | null = null

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

async function renderSelector(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<PlaneBoardSelector workspaces={workspaces} />)
  })
  return container
}

function selectByLabel(el: HTMLDivElement, label: string): HTMLSelectElement {
  const select = Array.from(el.querySelectorAll('select')).find(
    (s) => s.getAttribute('aria-label') === label
  )
  if (!select) {
    throw new Error(`Select "${label}" not found`)
  }
  return select
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
  setter?.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('PlaneBoardSelector', () => {
  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    mocks.store.current = null
  })

  it('renders nothing when there are no connected workspaces', async () => {
    installStore(null)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<PlaneBoardSelector workspaces={[]} />)
    })
    expect(container.textContent).toBe('')
  })

  it('persists defaultPlaneSelection when a workspace and project are chosen', async () => {
    const updateSettings = vi.fn(async () => {})
    installStore(null, updateSettings)
    const rendered = await renderSelector()

    await act(async () => {
      setSelectValue(selectByLabel(rendered, 'Plane workspace'), 'ws-2')
    })
    // Switching workspaces loads that workspace's project list asynchronously.
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      setSelectValue(selectByLabel(rendered, 'Plane project'), 'proj-2')
    })

    expect(updateSettings).toHaveBeenCalledWith({
      defaultPlaneSelection: { workspaceSlug: 'beta', projectId: 'proj-2' }
    })
  })

  it('preselects the persisted workspace and project on mount', async () => {
    installStore({ workspaceSlug: 'beta', projectId: 'proj-2' })
    const rendered = await renderSelector()
    await act(async () => {
      await Promise.resolve()
    })

    expect(selectByLabel(rendered, 'Plane workspace').value).toBe('ws-2')
    expect(selectByLabel(rendered, 'Plane project').value).toBe('proj-2')
  })
})
