// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, string>) =>
    options?.value0 === undefined ? fallback : fallback.replace('{{value0}}', options.value0)
}))

const { openSettingsPageMock, openSettingsTargetMock } = vi.hoisted(() => ({
  openSettingsPageMock: vi.fn(),
  openSettingsTargetMock: vi.fn()
}))

type AppStoreSlice = {
  openSettingsPage: typeof openSettingsPageMock
  openSettingsTarget: typeof openSettingsTargetMock
}

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: AppStoreSlice) => unknown) =>
    selector({
      openSettingsPage: openSettingsPageMock,
      openSettingsTarget: openSettingsTargetMock
    })
}))

import { PluginPendingApprovalNotice } from './PluginPendingApprovalNotice'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  openSettingsPageMock.mockReset()
  openSettingsTargetMock.mockReset()
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
})

async function renderNotice(approval: 'pending-install' | 'pending-update'): Promise<void> {
  await act(async () => {
    root.render(<PluginPendingApprovalNotice pluginName="WA Inbox" approval={approval} />)
  })
}

describe('PluginPendingApprovalNotice', () => {
  it('names a first install as waiting for approval', async () => {
    await renderNotice('pending-install')

    expect(container.textContent).toContain('WA Inbox is waiting for your approval')
    expect(container.textContent).toContain('before it runs for the first time')
    expect(container.textContent).not.toContain('updated')
  })

  it('names an update as needing approval again', async () => {
    await renderNotice('pending-update')

    expect(container.textContent).toContain('WA Inbox was updated and needs your approval again')
    expect(container.textContent).toContain('changed what the plugin declares')
  })

  it('routes the review action to the Plugins settings pane', async () => {
    await renderNotice('pending-update')
    const button = container.querySelector('button')
    expect(button?.textContent).toBe('Review & enable')

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(openSettingsTargetMock).toHaveBeenCalledWith({ pane: 'plugins', repoId: null })
    expect(openSettingsPageMock).toHaveBeenCalledTimes(1)
  })
})
