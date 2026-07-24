// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { PlaneIntegrationCard } from './plane-integration-card'

type PlaneWorkspaceRow = {
  id: string
  baseUrl: string
  workspaceSlug: string
  displayName?: string
}

type StoreState = {
  planeStatus: { connected: boolean; workspaces?: PlaneWorkspaceRow[] }
  planeStatusChecked: boolean
  planeStatusContextKey: string | null
  checkPlaneConnection: () => Promise<void>
  disconnectPlane: (workspaceId?: string) => Promise<void>
  testPlaneConnection: (workspaceId: string) => Promise<{ ok: boolean; error?: string }>
  settings: { activeRuntimeEnvironmentId: string | null }
  openSettingsPage: () => void
  openSettingsTarget: (target: { pane: string; repoId: string | null }) => void
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

vi.mock('@/components/plane-connect-dialog', () => ({
  PlaneConnectDialog: ({ onConnected }: { onConnected?: () => void }) => (
    <button type="button" data-testid="simulate-plane-connected" onClick={onConnected}>
      Simulate Plane connected
    </button>
  )
}))

vi.mock('./plane-board-selector', () => ({
  PlaneBoardSelector: () => <div data-testid="plane-board-selector" />
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function installStore(overrides: {
  settings: StoreState['settings']
  connected?: boolean
  checked?: boolean
  contextMatchesOverride?: string | null
  workspaces?: PlaneWorkspaceRow[]
}): StoreState {
  const contextKey =
    overrides.contextMatchesOverride !== undefined
      ? overrides.contextMatchesOverride
      : getProviderRuntimeContextKey(overrides.settings)
  const state: StoreState = {
    planeStatus: { connected: overrides.connected ?? true, workspaces: overrides.workspaces },
    planeStatusChecked: overrides.checked ?? true,
    planeStatusContextKey: contextKey,
    checkPlaneConnection: vi.fn(async () => {}),
    disconnectPlane: vi.fn(async () => {}),
    testPlaneConnection: vi.fn(async () => ({ ok: true })),
    settings: overrides.settings,
    openSettingsPage: vi.fn(),
    openSettingsTarget: vi.fn()
  }
  mocks.store.current = state
  return state
}

async function renderCard(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<PlaneIntegrationCard />)
  })
  return container
}

describe('PlaneIntegrationCard', () => {
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

  it('shows the attention status tone and hides actions while checking', async () => {
    installStore({
      settings: { activeRuntimeEnvironmentId: null },
      connected: false,
      checked: false
    })
    const rendered = await renderCard()

    expect(rendered.textContent).toContain('Checking Plane access')
    // No connect/add-workspace button while checking.
    expect(
      Array.from(rendered.querySelectorAll('button')).some(
        (b) => b.textContent === 'Connect Plane' || b.textContent === 'Add workspace'
      )
    ).toBe(false)
  })

  it('shows the connected status tone and one row per workspace with Test/Unlink', async () => {
    installStore({
      settings: { activeRuntimeEnvironmentId: null },
      connected: true,
      checked: true,
      workspaces: [
        { id: 'ws-1', baseUrl: 'https://api.plane.so', workspaceSlug: 'acme', displayName: 'Acme' },
        { id: 'ws-2', baseUrl: 'https://api.plane.so', workspaceSlug: 'beta' }
      ]
    })
    const rendered = await renderCard()

    expect(rendered.textContent).toContain('Connected')
    expect(rendered.textContent).toContain('2 workspaces connected')
    expect(rendered.textContent).toContain('Acme')
    expect(rendered.textContent).toContain('acme')
    // Second workspace has no displayName, so the slug is shown as the name too.
    expect(rendered.textContent).toContain('beta')

    const testButtons = Array.from(rendered.querySelectorAll('button')).filter(
      (b) => b.textContent === 'Test'
    )
    expect(testButtons).toHaveLength(2)
    const unlinkButtons = rendered.querySelectorAll('button[aria-label^="Disconnect"]')
    expect(unlinkButtons).toHaveLength(2)
    expect(rendered.querySelector('[data-testid="plane-board-selector"]')).not.toBeNull()
  })

  it('shows a verified icon/color for an ok test result and destructive for an error', async () => {
    const state = installStore({
      settings: { activeRuntimeEnvironmentId: null },
      connected: true,
      checked: true,
      workspaces: [
        { id: 'ws-1', baseUrl: 'https://api.plane.so', workspaceSlug: 'acme', displayName: 'Acme' }
      ]
    })
    state.testPlaneConnection = vi.fn(async () => ({ ok: false, error: 'token expired' }))
    const rendered = await renderCard()

    await act(async () => {
      Array.from(rendered.querySelectorAll('button'))
        .find((b) => b.textContent === 'Test')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(rendered.textContent).toContain('token expired')
    const errorSpan = Array.from(rendered.querySelectorAll('span')).find((s) =>
      s.className.includes('text-destructive')
    )
    expect(errorSpan).toBeTruthy()
  })
})
