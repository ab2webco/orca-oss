// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileInstallRequestState } from '../../../shared/remote-server-update'
import type { UpdaterApi } from '../../../preload/api/updater-api'
import { MobileInstallRequestDialog } from './MobileInstallRequestDialog'

const storeMock = vi.hoisted(() => ({
  state: {
    updateStatus: { state: 'downloaded', version: '1.5.1' } as { state: string; version?: string }
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof storeMock.state) => unknown) => selector(storeMock.state)
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    open,
    onOpenChange,
    children
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    children: React.ReactNode
  }) =>
    open ? (
      <div>
        <button type="button" data-testid="dismiss" onClick={() => onOpenChange(false)} />
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

const NOW = 1_000_000
const countdown: MobileInstallRequestState = {
  requestId: 'req-1',
  deviceName: 'Pixel 9',
  phase: 'countdown',
  deadlineAt: NOW + 30_000
}

type Harness = {
  host: HTMLDivElement
  root: Root
  api: {
    getMobileInstallRequest: ReturnType<typeof vi.fn>
    cancelMobileInstall: ReturnType<typeof vi.fn>
    restartMobileInstallNow: ReturnType<typeof vi.fn>
    quitAndInstall: ReturnType<typeof vi.fn>
    onMobileInstallRequest: ReturnType<typeof vi.fn>
    onMobileInstallRestart: ReturnType<typeof vi.fn>
  }
  push: (request: MobileInstallRequestState | null) => void
  restart: () => void
}

let harness: Harness | null = null

async function mount(initial: MobileInstallRequestState | null): Promise<Harness> {
  let pushRequest: (request: MobileInstallRequestState | null) => void = () => {}
  let pushRestart: () => void = () => {}
  const api = {
    getMobileInstallRequest: vi.fn(() => Promise.resolve(initial)),
    cancelMobileInstall: vi.fn(() => Promise.resolve(true)),
    restartMobileInstallNow: vi.fn(() => Promise.resolve(true)),
    quitAndInstall: vi.fn(() => Promise.resolve()),
    onMobileInstallRequest: vi.fn((callback: typeof pushRequest) => {
      pushRequest = callback
      return () => {}
    }),
    onMobileInstallRestart: vi.fn((callback: () => void) => {
      pushRestart = callback
      return () => {}
    })
  }
  ;(window as unknown as { api: { updater: Partial<UpdaterApi> } }).api = {
    updater: api as unknown as Partial<UpdaterApi>
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<MobileInstallRequestDialog />))
  harness = {
    host,
    root,
    api,
    push: (request) => act(() => pushRequest(request)),
    restart: () => act(() => pushRestart())
  }
  return harness
}

function button(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((node) => node.textContent === label)
}

describe('MobileInstallRequestDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    storeMock.state.updateStatus = { state: 'downloaded', version: '1.5.1' }
  })

  afterEach(async () => {
    await act(async () => harness?.root.unmount())
    document.body.innerHTML = ''
    harness = null
    vi.useRealTimers()
  })

  it('renders nothing while no phone has asked', async () => {
    const { host } = await mount(null)

    expect(host.textContent).toBe('')
  })

  it('names the device and the seconds left, and counts down', async () => {
    const { host } = await mount(countdown)

    expect(host.textContent).toContain('Pixel 9')
    expect(host.textContent).toContain('1.5.1')
    expect(host.textContent).toContain('in 30s')

    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(host.textContent).toContain('in 20s')
  })

  it('picks up a request pushed after mount and closes when it ends', async () => {
    const { host, push } = await mount(null)

    push(countdown)
    expect(host.textContent).toContain('Pixel 9')

    push(null)
    expect(host.textContent).toBe('')
  })

  it('cancels the request from Cancel and from dismissing the dialog', async () => {
    const { host, api } = await mount(countdown)

    await act(async () => button(host, 'Cancel')?.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="dismiss"]')?.click())

    expect(api.cancelMobileInstall.mock.calls).toEqual([['req-1'], ['req-1']])
    expect(api.restartMobileInstallNow).not.toHaveBeenCalled()
  })

  it('restarts immediately from Restart now', async () => {
    const { host, api } = await mount(countdown)

    await act(async () => button(host, 'Restart now')?.click())

    expect(api.restartMobileInstallNow).toHaveBeenCalledWith('req-1')
    expect(api.cancelMobileInstall).not.toHaveBeenCalled()
  })

  it('while the update downloads, offers only Cancel', async () => {
    storeMock.state.updateStatus = { state: 'downloading', version: '1.5.1' }
    const { host } = await mount({ ...countdown, phase: 'downloading', deadlineAt: null })

    expect(host.textContent).toContain('Pixel 9')
    expect(button(host, 'Cancel')).toBeDefined()
    expect(button(host, 'Restart now')).toBeUndefined()
  })

  it('restarts through the window save-and-quit path when main asks for it', async () => {
    const { api, restart } = await mount(countdown)

    restart()

    expect(api.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})
