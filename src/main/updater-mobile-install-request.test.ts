import { describe, expect, it, vi } from 'vitest'
import type { MobileInstallBlockingAgent } from '../shared/remote-server-update'
import {
  createMobileInstallRequestController,
  type MobileInstallControllerDeps
} from './updater-mobile-install-request'

type Harness = {
  deps: MobileInstallControllerDeps
  state: { updateState: 'available' | 'downloaded' | 'idle' | 'error' }
  agents: MobileInstallBlockingAgent[]
  optedIn: { value: boolean }
  install: ReturnType<typeof vi.fn>
  download: ReturnType<typeof vi.fn>
  fireTimer: () => void
  onChange: ReturnType<typeof vi.fn>
}

function harness(
  overrides: Partial<{ optedIn: boolean; updateState: Harness['state']['updateState'] }> = {}
): Harness {
  const state = { updateState: overrides.updateState ?? 'downloaded' }
  const agents: MobileInstallBlockingAgent[] = []
  const optedIn = { value: overrides.optedIn ?? true }
  const install = vi.fn()
  const download = vi.fn()
  const onChange = vi.fn()
  let timer: (() => void) | null = null
  const deps: MobileInstallControllerDeps = {
    isOptedIn: () => optedIn.value,
    isInstallSupported: () => true,
    getUpdateState: () => state.updateState,
    download,
    install,
    listWorkingAgents: () => agents,
    now: () => 1_000,
    setTimer: (fn) => {
      timer = fn
      return () => {
        timer = null
      }
    },
    countdownMs: 30_000,
    createRequestId: () => 'req-1',
    onChange
  }
  return {
    deps,
    state,
    agents,
    optedIn,
    install,
    download,
    onChange,
    fireTimer: () => {
      const fire = timer
      timer = null
      fire?.()
    }
  }
}

describe('mobile install request controller', () => {
  it('refuses while the desktop opt-in is off, and installs nothing', () => {
    const h = harness({ optedIn: false })
    const controller = createMobileInstallRequestController(h.deps)

    expect(controller.request('Phone')).toEqual({
      accepted: false,
      reason: 'disabled',
      agents: []
    })
    expect(h.install).not.toHaveBeenCalled()
    expect(controller.current()).toBeNull()
  })

  it('opens a countdown naming the device when the update is already downloaded', () => {
    const h = harness()
    const controller = createMobileInstallRequestController(h.deps)

    expect(controller.request('Pixel 9')).toEqual({
      accepted: true,
      request: {
        requestId: 'req-1',
        deviceName: 'Pixel 9',
        phase: 'countdown',
        deadlineAt: 31_000
      }
    })
    expect(h.install).not.toHaveBeenCalled()
  })

  it('refuses and lists the agents that would be interrupted', () => {
    const h = harness()
    h.agents.push({ paneKey: 'tab-1:0', agentType: 'claude' })
    const controller = createMobileInstallRequestController(h.deps)

    expect(controller.request('Phone')).toEqual({
      accepted: false,
      reason: 'agents-working',
      agents: [{ paneKey: 'tab-1:0', agentType: 'claude' }]
    })
    expect(controller.current()).toBeNull()
  })

  it('starts the download for an offered update and arms the countdown once downloaded', () => {
    const h = harness({ updateState: 'available' })
    const controller = createMobileInstallRequestController(h.deps)

    expect(controller.request('Phone')).toMatchObject({
      accepted: true,
      request: { phase: 'downloading', deadlineAt: null }
    })
    expect(h.download).toHaveBeenCalledTimes(1)
    expect(h.install).not.toHaveBeenCalled()

    controller.onUpdateStateChange('downloaded')
    expect(controller.current()).toMatchObject({ phase: 'countdown', deadlineAt: 31_000 })
  })

  it('ends a downloading request when the download fails', () => {
    const h = harness({ updateState: 'available' })
    const controller = createMobileInstallRequestController(h.deps)
    controller.request('Phone')

    controller.onUpdateStateChange('error')
    expect(controller.current()).toBeNull()
  })

  it('refuses on a headless serve host, where no desktop dialog can cancel the install', () => {
    const h = harness()
    const controller = createMobileInstallRequestController({
      ...h.deps,
      isInstallSupported: () => false
    })

    expect(controller.request('Phone')).toEqual({
      accepted: false,
      reason: 'not-available',
      agents: []
    })
    expect(h.install).not.toHaveBeenCalled()
  })

  it('refuses when there is no offered update to install', () => {
    const h = harness({ updateState: 'idle' })
    const controller = createMobileInstallRequestController(h.deps)

    expect(controller.request('Phone')).toEqual({
      accepted: false,
      reason: 'not-available',
      agents: []
    })
  })

  it('installs when the countdown times out', () => {
    const h = harness()
    const controller = createMobileInstallRequestController(h.deps)
    controller.request('Phone')

    h.fireTimer()
    expect(h.install).toHaveBeenCalledTimes(1)
    expect(controller.current()).toBeNull()
  })

  it('stops the install when the desktop cancels, and the cancel is final for that request', () => {
    const h = harness()
    const controller = createMobileInstallRequestController(h.deps)
    controller.request('Phone')

    expect(controller.cancel('req-1')).toBe(true)
    h.fireTimer()
    expect(h.install).not.toHaveBeenCalled()
    expect(controller.restartNow('req-1')).toBe(false)
    expect(controller.current()).toBeNull()
  })

  it('ignores a restart-now or cancel that names an older request', () => {
    const h = harness()
    const controller = createMobileInstallRequestController(h.deps)
    controller.request('Phone')

    expect(controller.restartNow('req-stale')).toBe(false)
    expect(controller.cancel('req-stale')).toBe(false)
    expect(h.install).not.toHaveBeenCalled()
    expect(controller.current()).not.toBeNull()
  })

  it('restarts immediately on Restart now', () => {
    const h = harness()
    const controller = createMobileInstallRequestController(h.deps)
    controller.request('Phone')

    expect(controller.restartNow('req-1')).toBe(true)
    expect(h.install).toHaveBeenCalledTimes(1)
    h.fireTimer()
    expect(h.install).toHaveBeenCalledTimes(1)
  })

  it('re-checks opt-in and agents at expiry and skips the install when either now blocks it', () => {
    const h = harness()
    const controller = createMobileInstallRequestController(h.deps)
    controller.request('Phone')

    h.agents.push({ paneKey: 'tab-2:0', agentType: 'codex' })
    h.fireTimer()
    expect(h.install).not.toHaveBeenCalled()
    expect(controller.current()).toBeNull()
  })

  it('reports every change to the desktop dialog and the phone snapshot', () => {
    const h = harness()
    const controller = createMobileInstallRequestController(h.deps)
    controller.request('Phone')
    controller.cancel('req-1')

    expect(h.onChange.mock.calls.map(([value]) => value)).toEqual([
      { requestId: 'req-1', deviceName: 'Phone', phase: 'countdown', deadlineAt: 31_000 },
      null
    ])
  })
})
