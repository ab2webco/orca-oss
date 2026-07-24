// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlaneConnectDialog } from './plane-connect-dialog'

type ConnectResult = { ok: true; viewer: unknown } | { ok: false; error: string }

type StoreState = {
  connectPlane: (args: {
    baseUrl: string
    workspaceSlug: string
    apiKey: string
  }) => Promise<ConnectResult>
  settings: { activeRuntimeEnvironmentId: string | null }
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

// Why: Radix Dialog renders into a body-level portal, which complicates DOM
// queries in tests. Swap it for plain divs so content renders inline, mirroring
// RemoteServerUpdateDialog.test.tsx.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function installStore(
  settings: StoreState['settings'],
  connectPlane: StoreState['connectPlane']
): StoreState {
  const state: StoreState = { connectPlane, settings }
  mocks.store.current = state
  return state
}

async function renderDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected?: () => void
}): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<PlaneConnectDialog {...props} />)
  })
  return container
}

function fillField(el: HTMLDivElement, labelText: string, value: string): void {
  const label = Array.from(el.querySelectorAll('label')).find((l) => l.textContent === labelText)
  const input = label?.parentElement?.querySelector('input')
  if (!input) {
    throw new Error(`Input for "${labelText}" not found`)
  }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function submitButton(el: HTMLDivElement): HTMLButtonElement {
  const button = Array.from(el.querySelectorAll('button')).find(
    (b) => b.getAttribute('type') === 'submit'
  )
  if (!button) {
    throw new Error('Submit button not found')
  }
  return button
}

describe('PlaneConnectDialog', () => {
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

  it('gates submit on all three fields being non-empty', async () => {
    installStore({ activeRuntimeEnvironmentId: null }, vi.fn())
    const rendered = await renderDialog({ open: true, onOpenChange: vi.fn() })

    expect(submitButton(rendered).disabled).toBe(true)

    await act(async () => {
      fillField(rendered, 'Plane base URL', 'https://api.plane.so')
    })
    expect(submitButton(rendered).disabled).toBe(true)

    await act(async () => {
      fillField(rendered, 'Workspace slug', 'my-workspace')
    })
    expect(submitButton(rendered).disabled).toBe(true)

    await act(async () => {
      fillField(rendered, 'Personal access token', 'pat_abc')
    })
    expect(submitButton(rendered).disabled).toBe(false)
  })

  it('transitions connectState through connecting to error on failure', async () => {
    let resolveConnect: (value: ConnectResult) => void = () => {}
    const connectPlane = vi.fn(
      () =>
        new Promise<ConnectResult>((resolve) => {
          resolveConnect = resolve
        })
    )
    installStore({ activeRuntimeEnvironmentId: null }, connectPlane)
    const rendered = await renderDialog({ open: true, onOpenChange: vi.fn() })

    await act(async () => {
      fillField(rendered, 'Plane base URL', 'https://api.plane.so')
      fillField(rendered, 'Workspace slug', 'my-workspace')
      fillField(rendered, 'Personal access token', 'pat_abc')
    })

    await act(async () => {
      submitButton(rendered).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // connecting: button shows verifying copy and is disabled by canSubmit gate
    expect(rendered.textContent).toContain('Verifying')

    await act(async () => {
      resolveConnect({ ok: false, error: 'invalid token' })
    })

    expect(rendered.textContent).toContain('invalid token')
  })

  it('closes and calls onConnected when connect succeeds, even reusing an existing key', async () => {
    const connectPlane = vi.fn(async () => ({ ok: true as const, viewer: {} }))
    installStore({ activeRuntimeEnvironmentId: null }, connectPlane)
    const onOpenChange = vi.fn()
    const onConnected = vi.fn()
    const rendered = await renderDialog({ open: true, onOpenChange, onConnected })

    await act(async () => {
      fillField(rendered, 'Plane base URL', 'https://api.plane.so')
      fillField(rendered, 'Workspace slug', 'second-workspace')
      fillField(rendered, 'Personal access token', 'pat_shared_across_workspaces')
    })

    await act(async () => {
      submitButton(rendered).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // No "already connected" client-side rejection: the same PAT is accepted
    // for a different workspace slug (account-level token reuse).
    expect(connectPlane).toHaveBeenCalledWith({
      baseUrl: 'https://api.plane.so',
      workspaceSlug: 'second-workspace',
      apiKey: 'pat_shared_across_workspaces'
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConnected).toHaveBeenCalledTimes(1)
  })

  it('resets fields on every open transition', async () => {
    const connectPlane = vi.fn()
    installStore({ activeRuntimeEnvironmentId: null }, connectPlane)
    const onOpenChange = vi.fn()
    const rendered = await renderDialog({ open: true, onOpenChange })

    await act(async () => {
      fillField(rendered, 'Plane base URL', 'https://api.plane.so')
      fillField(rendered, 'Workspace slug', 'my-workspace')
      fillField(rendered, 'Personal access token', 'pat_abc')
    })
    expect(submitButton(rendered).disabled).toBe(false)

    // Close, then reopen: fields must not carry the previous draft over.
    await act(async () => {
      root?.render(<PlaneConnectDialog open={false} onOpenChange={onOpenChange} />)
    })
    await act(async () => {
      root?.render(<PlaneConnectDialog open={true} onOpenChange={onOpenChange} />)
    })

    expect(submitButton(rendered).disabled).toBe(true)
    const baseUrlLabel = Array.from(rendered.querySelectorAll('label')).find(
      (l) => l.textContent === 'Plane base URL'
    )
    const baseUrlInput = baseUrlLabel?.parentElement?.querySelector('input') as HTMLInputElement
    expect(baseUrlInput.value).toBe('')
  })

  it('branches credentialStorageCopy on hasRemoteProviderRuntime', async () => {
    installStore({ activeRuntimeEnvironmentId: 'runtime-1' }, vi.fn())
    const remoteRendered = await renderDialog({ open: true, onOpenChange: vi.fn() })
    expect(remoteRendered.textContent).toContain('sent to the selected remote runtime')

    await act(async () => {
      root?.unmount()
    })
    container?.remove()

    installStore({ activeRuntimeEnvironmentId: null }, vi.fn())
    const localRendered = await renderDialog({ open: true, onOpenChange: vi.fn() })
    expect(localRendered.textContent).toContain('stored locally')
  })
})
