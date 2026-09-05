import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { RpcClient } from '../transport/rpc-client'

const asyncStorage = vi.hoisted(() => ({
  getItem: vi.fn().mockResolvedValue(null),
  setItem: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: asyncStorage }))
// Why: lucide's circular ESM re-exports do not load under Vite's runner; icons are not under test.
vi.mock('lucide-react-native', async () => {
  const { createElement: h } = await import('react')
  const Icon = () => h('span')
  return new Proxy(
    {},
    {
      get: (_target, name) => (typeof name === 'string' && name !== 'then' ? Icon : undefined),
      has: (_target, name) => typeof name === 'string' && name !== 'then'
    }
  )
})

import { setCachedRepos } from '../cache/repo-cache'
import { BOTTOM_DRAWER_HIDE_DURATION_MS } from './bottom-drawer-constants'
import { NewWorktreeModal } from './NewWorktreeModal'

const repos = [
  {
    id: 'repo-1',
    displayName: 'orca',
    path: '/src/orca',
    kind: 'git',
    upstream: { owner: 'stablyai', repo: 'orca' }
  }
]

const safeAreaMetrics = {
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 }
}

// Why: the navigation hook waits one extra frame past the hide animation before showing the next drawer.
const DRAWER_TRANSITION_MS = BOTTOM_DRAWER_HIDE_DURATION_MS + 16

function createClient(): RpcClient {
  return {
    sendRequest: vi.fn().mockImplementation((method: string) => {
      if (method === 'repo.list') {
        return Promise.resolve({ ok: true, result: { repos } })
      }
      if (method === 'status.get') {
        return Promise.resolve({ ok: true, result: { hostPlatform: 'darwin' } })
      }
      return new Promise(() => {})
    })
  } as unknown as RpcClient
}

function leafWithText(text: string, scope: ParentNode = document.body): HTMLElement | null {
  for (const element of scope.querySelectorAll<HTMLElement>('div')) {
    if (element.childElementCount === 0 && element.textContent === text) {
      return element
    }
  }
  return null
}

// The RNW Modal host is also aria-modal; only drawer overlays carry no dialog role.
function drawerOverlays(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('[aria-modal]:not([role="dialog"])')]
}

function interactiveDrawerCount(): number {
  return drawerOverlays().filter((overlay) => overlay.getAttribute('aria-modal') === 'true').length
}

function formOverlay(): HTMLElement | null {
  return drawerOverlays().find((overlay) => leafWithText('Create worktree', overlay)) ?? null
}

// Picker titles repeat the form's row labels, so a picker is a non-form overlay showing that title.
function pickerOverlay(title: string): HTMLElement | null {
  return (
    drawerOverlays().find(
      (overlay) => !leafWithText('Create worktree', overlay) && leafWithText(title, overlay)
    ) ?? null
  )
}

function pressFormRow(label: string): void {
  const form = formOverlay()
  const row = form ? leafWithText(label, form)?.nextElementSibling : null
  if (!(row instanceof HTMLElement)) {
    throw new Error(`form row "${label}" is not mounted`)
  }
  act(() => row.click())
}

function pressBackdropOf(overlay: HTMLElement): void {
  const backdrop = overlay.querySelector<HTMLElement>('[tabindex="0"]')
  if (!backdrop) {
    throw new Error('drawer overlay has no backdrop pressable')
  }
  act(() => backdrop.click())
}

function advanceDrawerTransition(): void {
  act(() => vi.advanceTimersByTime(DRAWER_TRANSITION_MS))
}

describe('NewWorktreeModal drawer stack (react-native-web)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    setCachedRepos('host-1', repos)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  async function mountModal(): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          SafeAreaProvider,
          { initialMetrics: safeAreaMetrics },
          createElement(NewWorktreeModal, {
            visible: true,
            client: createClient(),
            hostId: 'host-1',
            onCreated: () => {},
            onClose: () => {}
          })
        )
      )
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })
  }

  it('unmounts each drawer before the next one mounts across form → picker → form → picker', async () => {
    await mountModal()

    expect(formOverlay()).not.toBeNull()
    expect(drawerOverlays()).toHaveLength(1)
    expect(interactiveDrawerCount()).toBe(1)

    pressFormRow('Project')
    // Form hides during the transition; the picker must not appear until it is gone.
    expect(formOverlay()).toBeNull()
    expect(pickerOverlay('Project')).toBeNull()
    expect(drawerOverlays()).toHaveLength(0)

    advanceDrawerTransition()
    const projectPicker = pickerOverlay('Project')
    expect(projectPicker).not.toBeNull()
    expect(formOverlay()).toBeNull()
    expect(drawerOverlays()).toHaveLength(1)
    expect(projectPicker?.getAttribute('aria-modal')).toBe('true')

    pressBackdropOf(projectPicker!)
    expect(pickerOverlay('Project')).toBeNull()
    expect(drawerOverlays()).toHaveLength(0)

    advanceDrawerTransition()
    expect(pickerOverlay('Project')).toBeNull()
    expect(formOverlay()?.getAttribute('aria-modal')).toBe('true')
    expect(drawerOverlays()).toHaveLength(1)

    pressFormRow('Agent')
    expect(formOverlay()).toBeNull()
    expect(drawerOverlays()).toHaveLength(0)

    advanceDrawerTransition()
    expect(pickerOverlay('Project')).toBeNull()
    expect(formOverlay()).toBeNull()
    expect(pickerOverlay('Agent')?.getAttribute('aria-modal')).toBe('true')
    expect(drawerOverlays()).toHaveLength(1)
    expect(interactiveDrawerCount()).toBe(1)
  })
})
