// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PANEL_CONTENT_HEIGHT_MAX_PX,
  PANEL_CONTENT_HEIGHT_TYPE
} from '../../../../shared/plugins/plugin-panel-bridge'
import type { ActivePluginPanel, PluginPanelApproval } from '@/store/plugin-panels'

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

const { usePluginPanelsMock, setPanelHealthMock, usePluginPanelApprovalMock } = vi.hoisted(() => ({
  usePluginPanelsMock: vi.fn<() => ActivePluginPanel[]>(() => []),
  setPanelHealthMock: vi.fn(),
  usePluginPanelApprovalMock: vi.fn<() => PluginPanelApproval>(() => 'approved')
}))

const { watchdogStartMock, watchdogStopMock, watchdogCallbacks } = vi.hoisted(() => ({
  watchdogStartMock: vi.fn(),
  watchdogStopMock: vi.fn(),
  watchdogCallbacks: { onUnresponsive: null as (() => void) | null }
}))

vi.mock('@/store/plugin-panels', () => ({
  usePluginPanels: usePluginPanelsMock,
  usePluginPanelApproval: usePluginPanelApprovalMock,
  usePluginPanelsStore: (
    selector: (state: { setPanelHealth: typeof setPanelHealthMock }) => unknown
  ) => selector({ setPanelHealth: setPanelHealthMock })
}))

vi.mock('./plugin-panel-watchdog', () => ({
  createPanelWatchdog: (options: { onUnresponsive: () => void }) => {
    watchdogCallbacks.onUnresponsive = options.onUnresponsive
    return {
      start: watchdogStartMock,
      stop: watchdogStopMock,
      handlePong: vi.fn()
    }
  }
}))

import PluginPanel from './PluginPanel'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const dashboardPanel: ActivePluginPanel = {
  id: 'dashboard',
  title: 'Dashboard',
  icon: 'gauge',
  tabKey: 'plugin:orca-samples.my-plugin/dashboard',
  pluginKey: 'orca-samples.my-plugin',
  pluginName: 'My Plugin'
}

let container: HTMLDivElement
let root: Root
const readPanelEntryMock = vi.fn()
const panelActionMock = vi.fn()
const SESSION_TOKEN = 's'.repeat(43)
const REFRESHED_SESSION_TOKEN = 'r'.repeat(43)
let pluginChangedListener: (() => void) | null

function waitForHappyDomTasks(): Promise<void> {
  return (
    window as unknown as { happyDOM: { waitUntilComplete: () => Promise<void> } }
  ).happyDOM.waitUntilComplete()
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  readPanelEntryMock.mockReset()
  panelActionMock.mockReset()
  panelActionMock.mockResolvedValue({ ok: true, value: { delivered: true } })
  watchdogStartMock.mockReset()
  watchdogStopMock.mockReset()
  watchdogCallbacks.onUnresponsive = null
  setPanelHealthMock.mockReset()
  document.documentElement.classList.remove('dark')
  pluginChangedListener = null
  openSettingsPageMock.mockReset()
  openSettingsTargetMock.mockReset()
  usePluginPanelApprovalMock.mockReturnValue('approved')
  usePluginPanelsMock.mockReturnValue([dashboardPanel])
  globalThis.window.api = {
    plugins: {
      readPanelEntry: readPanelEntryMock,
      panelAction: panelActionMock,
      onChanged: (listener: () => void) => {
        pluginChangedListener = listener
        return vi.fn()
      }
    }
  } as unknown as Window['api']
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function renderPanel(tabKey: string): Promise<void> {
  await act(async () => {
    root.render(<PluginPanel tabKey={tabKey} />)
  })
}

async function renderFlowingPanel(tabKey: string): Promise<HTMLIFrameElement> {
  await act(async () => {
    root.render(<PluginPanel tabKey={tabKey} flowWithContentHeight />)
  })
  const iframe = container.querySelector('iframe')
  if (!iframe) {
    throw new Error('panel iframe did not render')
  }
  return iframe
}

/** Posts a height frame the way the sandboxed panel does: the frame's origin is
 *  opaque, so `source` is the only identity the host can check. */
async function postHeight(source: Window | null, height: unknown): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: PANEL_CONTENT_HEIGHT_TYPE, height },
        source
      })
    )
  })
}

describe('PluginPanel', () => {
  it.each([
    ['pending-install', 'My Plugin is waiting for your approval'],
    ['pending-update', 'My Plugin was updated and needs your approval again']
  ] as const)('serves the approval notice instead of a %s panel', async (approval, heading) => {
    usePluginPanelApprovalMock.mockReturnValue(approval)

    await renderPanel(dashboardPanel.tabKey)

    expect(container.querySelector('[data-testid="plugin-pending-approval"]')).not.toBeNull()
    expect(container.textContent).toContain(heading)
    expect(container.querySelector('iframe')).toBeNull()
    // Pedir la entrada de un plugin pendiente solo devuelve el estado de error
    // que hace pasar la espera de aprobacion por una falla del panel.
    expect(readPanelEntryMock).not.toHaveBeenCalled()
  })

  it('renders the panel HTML in a scripts-only sandboxed iframe', async () => {
    readPanelEntryMock.mockResolvedValue({
      html: '<h1>Hello plugin</h1>',
      sessionToken: SESSION_TOKEN
    })

    await renderPanel('plugin:orca-samples.my-plugin/dashboard')

    const initialIframe = container.querySelector('iframe')
    expect(initialIframe).not.toBeNull()
    expect(readPanelEntryMock).toHaveBeenCalledWith({
      pluginKey: 'orca-samples.my-plugin',
      panelId: 'dashboard'
    })
    expect(initialIframe?.getAttribute('srcdoc')).toContain('<h1>Hello plugin</h1>')
    expect(initialIframe?.getAttribute('title')).toBe('Dashboard')
    expect(initialIframe?.getAttribute('name')).toBe(
      'orca-plugin-panel:plugin:orca-samples.my-plugin/dashboard'
    )
    // Why: allow-same-origin would let plugin HTML reach the app DOM/storage;
    // the sandbox must stay scripts-only.
    expect(initialIframe?.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('restarts the watchdog after a dev reload replaces the panel document', async () => {
    readPanelEntryMock.mockResolvedValue({
      html: '<h1>Hello plugin</h1>',
      sessionToken: SESSION_TOKEN
    })

    await renderPanel('plugin:orca-samples.my-plugin/dashboard')

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(watchdogStartMock).toHaveBeenCalledTimes(1)

    readPanelEntryMock.mockResolvedValue({
      html: '<h1>Reloaded plugin</h1>',
      sessionToken: SESSION_TOKEN
    })
    await act(async () => {
      pluginChangedListener?.()
      await waitForHappyDomTasks()
    })

    const reloadedIframe = container.querySelector('iframe')
    expect(reloadedIframe).not.toBe(iframe)
    expect(reloadedIframe?.getAttribute('srcdoc')).toContain('Reloaded plugin')
    expect(watchdogStopMock).toHaveBeenCalledTimes(1)
    expect(watchdogStartMock).toHaveBeenCalledTimes(2)
  })

  it('remounts with fresh host theme tokens when the app theme changes', async () => {
    readPanelEntryMock.mockResolvedValue({
      html: '<html class="__ORCA_COLOR_SCHEME__"><head><style>:root{/*__ORCA_PANEL_TOKENS__*/}</style></head>',
      sessionToken: SESSION_TOKEN
    })
    await renderPanel('plugin:orca-samples.my-plugin/dashboard')
    const lightFrame = container.querySelector('iframe')
    expect(lightFrame?.getAttribute('srcdoc')).toContain('<html class="light">')

    await act(async () => {
      document.documentElement.classList.add('dark')
      await waitForHappyDomTasks()
    })

    const darkFrame = container.querySelector('iframe')
    expect(darkFrame).not.toBe(lightFrame)
    expect(darkFrame?.getAttribute('srcdoc')).toContain('<html class="dark">')
  })

  it('rebinds a refreshed session without remounting unchanged panel HTML', async () => {
    readPanelEntryMock.mockResolvedValue({
      html: '<h1>Hello plugin</h1>',
      sessionToken: SESSION_TOKEN
    })
    await renderPanel('plugin:orca-samples.my-plugin/dashboard')
    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(watchdogStartMock).toHaveBeenCalledTimes(1)

    readPanelEntryMock.mockResolvedValue({
      html: '<h1>Hello plugin</h1>',
      sessionToken: REFRESHED_SESSION_TOKEN
    })
    await act(async () => {
      pluginChangedListener?.()
      await waitForHappyDomTasks()
    })

    expect(container.querySelector('iframe')).toBe(iframe)
    expect(watchdogStopMock).not.toHaveBeenCalled()
    expect(watchdogStartMock).toHaveBeenCalledTimes(1)

    const event = new MessageEvent('message', {
      data: {
        type: 'orca-panel-action',
        requestId: 'request-one',
        action: 'notifications.show',
        params: { title: 'Hello' }
      }
    })
    Object.defineProperty(event, 'source', { value: iframe?.contentWindow })
    await act(async () => {
      window.dispatchEvent(event)
      await waitForHappyDomTasks()
    })
    expect(panelActionMock).toHaveBeenCalledWith({
      sessionToken: REFRESHED_SESSION_TOKEN,
      action: 'notifications.show',
      params: { title: 'Hello' }
    })
  })

  it('ignores an obsolete panel reload that finishes after a newer one', async () => {
    readPanelEntryMock.mockResolvedValueOnce({
      html: '<h1>Initial plugin</h1>',
      sessionToken: SESSION_TOKEN
    })
    await renderPanel('plugin:orca-samples.my-plugin/dashboard')

    let resolveObsolete!: (entry: null) => void
    let resolveCurrent!: (entry: { html: string; sessionToken: string }) => void
    readPanelEntryMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveObsolete = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCurrent = resolve
          })
      )

    await act(async () => {
      pluginChangedListener?.()
      pluginChangedListener?.()
      resolveCurrent({
        html: '<h1>Current plugin</h1>',
        sessionToken: REFRESHED_SESSION_TOKEN
      })
      await waitForHappyDomTasks()
    })
    await act(async () => {
      resolveObsolete(null)
      await waitForHappyDomTasks()
    })

    expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain('Current plugin')
    expect(container.textContent).not.toContain('could not be loaded')
  })

  it('shows an error state when the panel entry cannot be read', async () => {
    readPanelEntryMock.mockResolvedValue(null)

    await renderPanel('plugin:orca-samples.my-plugin/dashboard')

    expect(container.querySelector('iframe')).toBeNull()
    expect(container.textContent).toContain('The plugin panel could not be loaded.')
  })

  it('recovers from a transient read failure with byte-identical HTML', async () => {
    readPanelEntryMock.mockResolvedValue({
      html: '<h1>Hello plugin</h1>',
      sessionToken: SESSION_TOKEN
    })
    await renderPanel('plugin:orca-samples.my-plugin/dashboard')
    const initialFrame = container.querySelector('iframe')

    readPanelEntryMock.mockResolvedValueOnce(null)
    await act(async () => {
      pluginChangedListener?.()
      await waitForHappyDomTasks()
    })
    expect(container.textContent).toContain('could not be loaded')

    readPanelEntryMock.mockResolvedValueOnce({
      html: '<h1>Hello plugin</h1>',
      sessionToken: REFRESHED_SESSION_TOKEN
    })
    await act(async () => {
      pluginChangedListener?.()
      await waitForHappyDomTasks()
    })

    expect(container.querySelector('iframe')).not.toBe(initialFrame)
    expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain('Hello plugin')
    expect(setPanelHealthMock).toHaveBeenLastCalledWith(
      'plugin:orca-samples.my-plugin/dashboard',
      'healthy'
    )
  })

  it('publishes watchdog suspension to host-owned panel health state', async () => {
    readPanelEntryMock.mockResolvedValue({
      html: '<h1>Hello plugin</h1>',
      sessionToken: SESSION_TOKEN
    })
    await renderPanel('plugin:orca-samples.my-plugin/dashboard')

    await act(async () => watchdogCallbacks.onUnresponsive?.())

    expect(setPanelHealthMock).toHaveBeenCalledWith(
      'plugin:orca-samples.my-plugin/dashboard',
      'error'
    )
    expect(container.textContent).toContain('stopped responding and was suspended')
  })

  it('keeps a watchdog error published when navigation unmounts the failed panel', async () => {
    readPanelEntryMock.mockResolvedValue({
      html: '<h1>Hello plugin</h1>',
      sessionToken: SESSION_TOKEN
    })
    await renderPanel('plugin:orca-samples.my-plugin/dashboard')
    setPanelHealthMock.mockClear()
    await act(async () => watchdogCallbacks.onUnresponsive?.())

    await act(async () => root.render(<div>Explorer</div>))

    expect(setPanelHealthMock).toHaveBeenCalledTimes(1)
    expect(setPanelHealthMock).toHaveBeenCalledWith(
      'plugin:orca-samples.my-plugin/dashboard',
      'error'
    )
  })

  it('shows an unavailable state for a tab whose plugin is gone', async () => {
    usePluginPanelsMock.mockReturnValue([])

    await renderPanel('plugin:orca-samples.removed-plugin/dashboard')

    expect(readPanelEntryMock).not.toHaveBeenCalled()
    expect(container.textContent).toContain('This plugin panel is no longer available.')
  })

  it('treats a malformed plugin tab key as unavailable', async () => {
    await renderPanel('plugin:not-a-valid-key')

    expect(readPanelEntryMock).not.toHaveBeenCalled()
    expect(container.textContent).toContain('This plugin panel is no longer available.')
  })

  it('sizes the frame to the height the panel reports when the host asks it to', async () => {
    readPanelEntryMock.mockResolvedValue({
      html: '<h1>Hello plugin</h1>',
      sessionToken: SESSION_TOKEN
    })
    const iframe = await renderFlowingPanel('plugin:orca-samples.my-plugin/dashboard')

    await postHeight(iframe.contentWindow, 742)
    expect(iframe.style.height).toBe('742px')
    // No h-full: the page around it, not the frame, owns the scrolling now.
    expect(iframe.className).not.toContain('h-full')

    // The conversation list repopulates and a row expands long after load.
    await postHeight(iframe.contentWindow, 1180)
    expect(iframe.style.height).toBe('1180px')
    // ...and a section that collapses again must give the space back.
    await postHeight(iframe.contentWindow, 640)
    expect(iframe.style.height).toBe('640px')
  })

  it('ignores a height from any window that is not this panel frame', async () => {
    readPanelEntryMock.mockResolvedValue({
      html: '<h1>Hello plugin</h1>',
      sessionToken: SESSION_TOKEN
    })
    const iframe = await renderFlowingPanel('plugin:orca-samples.my-plugin/dashboard')
    await postHeight(iframe.contentWindow, 742)

    const foreignFrame = document.createElement('iframe')
    document.body.append(foreignFrame)
    await postHeight(foreignFrame.contentWindow, 2000)
    foreignFrame.remove()

    expect(iframe.style.height).toBe('742px')
  })

  it('refuses a height that is not a finite positive number', async () => {
    readPanelEntryMock.mockResolvedValue({
      html: '<h1>Hello plugin</h1>',
      sessionToken: SESSION_TOKEN
    })
    const iframe = await renderFlowingPanel('plugin:orca-samples.my-plugin/dashboard')
    await postHeight(iframe.contentWindow, 742)

    for (const height of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, '900']) {
      await postHeight(iframe.contentWindow, height)
      expect(iframe.style.height).toBe('742px')
    }
  })

  it('clamps a frame no panel can need instead of allocating it', async () => {
    readPanelEntryMock.mockResolvedValue({
      html: '<h1>Hello plugin</h1>',
      sessionToken: SESSION_TOKEN
    })
    const iframe = await renderFlowingPanel('plugin:orca-samples.my-plugin/dashboard')

    await postHeight(iframe.contentWindow, 2_000_000)

    expect(iframe.style.height).toBe(`${PANEL_CONTENT_HEIGHT_MAX_PX}px`)
  })

  it('keeps filling its box, and ignores reported heights, without the prop', async () => {
    readPanelEntryMock.mockResolvedValue({
      html: '<h1>Hello plugin</h1>',
      sessionToken: SESSION_TOKEN
    })
    await renderPanel('plugin:orca-samples.my-plugin/dashboard')
    const iframe = container.querySelector('iframe')

    await postHeight(iframe?.contentWindow ?? null, 742)

    // The right sidebar and the nav page hand the frame a box and expect it filled.
    expect(iframe?.className).toContain('h-full')
    expect(iframe?.getAttribute('style')).toBeNull()
  })
})
