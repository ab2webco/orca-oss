// @vitest-environment happy-dom

/**
 * Invariant: the sync dialog reads its inventory once per open, so a re-render of
 * the pane that owns it never unmounts the list nor resets its scroll (ORCA-525).
 * The read still re-runs when the account owner changes, because the old owner's
 * inventory names servers the new one does not have.
 */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalConfigSyncInventory } from '../../../../shared/global-config-sync'
import { getDefaultSettings } from '../../../../shared/constants'
import { i18n } from '../../i18n/i18n'
import { useAppStore } from '../../store'
import { GlobalConfigSyncDialog } from './GlobalConfigSyncDialog'

const preview = vi.fn<(settings: unknown) => Promise<GlobalConfigSyncInventory>>()

vi.mock('@/runtime/runtime-provider-global-config', () => ({
  previewGlobalConfigForProviderAccounts: (settings: unknown) => preview(settings),
  resyncGlobalConfigForProviderAccounts: vi.fn().mockResolvedValue(0),
  syncGlobalConfigForProviderAccount: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() })
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** Enough rows that the list is the tall thing on screen and worth scrolling. */
const INVENTORY: GlobalConfigSyncInventory = {
  mcpServers: Array.from({ length: 24 }, (_, index) => ({
    name: `server-${index}`,
    source: 'user-config' as const
  })),
  skills: Array.from({ length: 24 }, (_, index) => `skill-${index}`),
  hooks: []
}

const roots: Root[] = []

/** The caller shape that caused ORCA-525: an inline arrow, fresh every render. */
function Host(): React.JSX.Element {
  const [renderKey, setRenderKey] = useState(0)
  return (
    <div>
      <button type="button" data-testid="rerender" onClick={() => setRenderKey(renderKey + 1)}>
        {renderKey}
      </button>
      <GlobalConfigSyncDialog open onOpenChange={(open) => void open} />
    </div>
  )
}

function viewport(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
}

async function mountHost(): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<Host />)
  })
}

describe('GlobalConfigSyncDialog inventory reload', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    preview.mockReset()
    preview.mockResolvedValue(INVENTORY)
    useAppStore.setState({ settings: getDefaultSettings('/tmp') })
  })

  afterEach(() => {
    roots.splice(0).forEach((root) => {
      act(() => root.unmount())
    })
    document.body.replaceChildren()
  })

  it('keeps the list mounted and its scroll offset across a parent re-render', async () => {
    await mountHost()
    expect(preview).toHaveBeenCalledTimes(1)

    const list = viewport()
    expect(list, 'the inventory list never rendered').not.toBeNull()
    list!.scrollTop = 120
    expect(list!.scrollTop, 'happy-dom did not keep the offset — the check proves nothing').toBe(
      120
    )

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="rerender"]')!.click()
    })

    // Same node, still attached, same offset: no remount happened.
    expect(viewport(), 'the list was remounted by the re-render').toBe(list)
    expect(list!.isConnected, 'the list was torn off the document').toBe(true)
    expect(list!.scrollTop, 'the scroll offset was lost').toBe(120)
    expect(preview, 'the inventory was re-read').toHaveBeenCalledTimes(1)
  })

  it('re-reads the inventory when another host takes over the accounts', async () => {
    await mountHost()
    expect(preview).toHaveBeenCalledTimes(1)
    expect(preview).toHaveBeenLastCalledWith({ activeRuntimeEnvironmentId: null })

    await act(async () => {
      useAppStore.setState({
        settings: { ...getDefaultSettings('/tmp'), activeRuntimeEnvironmentId: 'env-1' }
      })
    })

    expect(preview).toHaveBeenCalledTimes(2)
    expect(preview).toHaveBeenLastCalledWith({ activeRuntimeEnvironmentId: 'env-1' })
  })

  it('does not re-read when an unrelated setting changes', async () => {
    await mountHost()
    expect(preview).toHaveBeenCalledTimes(1)

    await act(async () => {
      useAppStore.setState({
        settings: { ...getDefaultSettings('/tmp'), theme: 'light' }
      })
    })

    expect(preview).toHaveBeenCalledTimes(1)
  })
})
