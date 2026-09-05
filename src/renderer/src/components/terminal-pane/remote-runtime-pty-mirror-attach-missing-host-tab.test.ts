import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRemoteRuntimeTransportMocks,
  type MultiplexSubscriptionCallbacks
} from './remote-runtime-pty-transport-test-harness'

let subscriptionCallbacks: MultiplexSubscriptionCallbacks = null
let resolvedPaneHandle = 'terminal-1'

const { runtimeCall, emitSnapshot, latestSubscribePayload, resetRemoteRuntimeTransport } =
  createRemoteRuntimeTransportMocks({
    getCallbacks: () => subscriptionCallbacks,
    setCallbacks: (callbacks) => {
      subscriptionCallbacks = callbacks
    },
    getResolvedPaneHandle: () => resolvedPaneHandle,
    setResolvedPaneHandle: (handle) => {
      resolvedPaneHandle = handle
    }
  })

function missingHostTabResponse(): unknown {
  return { ok: false, error: { code: 'tab_not_found', message: 'tab_not_found' } }
}

describe('remote runtime pty mirror attach when the host does not know the tab yet', () => {
  beforeEach(() => {
    resetRemoteRuntimeTransport()
  })

  async function connectMirror() {
    const { createRemoteRuntimePtyTransport } = await import('./remote-runtime-pty-transport')
    const onError = vi.fn()
    const transport = createRemoteRuntimePtyTransport('env-1', {
      worktreeId: 'wt-1',
      tabId: 'web-terminal-host-tab-1',
      leafId: 'pane:1'
    })
    void transport.connect({ url: '', cols: 80, rows: 24, callbacks: { onError } })
    return { transport, onError }
  }

  it('reconnects once the relaunched host republishes the tab it first reported missing', async () => {
    vi.useFakeTimers()
    try {
      const rehydratedRuntimeCall = runtimeCall.getMockImplementation()!
      runtimeCall.mockImplementation(async (request: { method: string }) =>
        request.method === 'session.tabs.activate' || request.method === 'session.tabs.list'
          ? missingHostTabResponse()
          : rehydratedRuntimeCall(request)
      )

      const { transport, onError } = await connectMirror()
      await vi.advanceTimersByTimeAsync(0)

      // A pane parked at 'offline' with an idle recovery has no timer and no external trigger left.
      expect(transport.getRecoveryState?.().phase).not.toBe('offline')
      expect(onError).not.toHaveBeenCalled()

      runtimeCall.mockImplementation(rehydratedRuntimeCall)
      await vi.advanceTimersByTimeAsync(2_000)
      emitSnapshot(latestSubscribePayload().streamId, 'READY')

      expect(transport.isConnected()).toBe(true)
      expect(transport.getPtyId()).toBe('remote:env-1@@terminal-1')
      expect(onError).not.toHaveBeenCalled()
      transport.destroy?.()
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-activates the host surface with automatic intent so a slept pane stays slept', async () => {
    vi.useFakeTimers()
    try {
      const rehydratedRuntimeCall = runtimeCall.getMockImplementation()!
      let activations = 0
      runtimeCall.mockImplementation(async (request: { method: string; params?: unknown }) => {
        if (request.method === 'session.tabs.activate') {
          activations += 1
          if (activations === 1) {
            return missingHostTabResponse()
          }
        }
        if (request.method === 'session.tabs.list') {
          return missingHostTabResponse()
        }
        return rehydratedRuntimeCall(request)
      })

      const { transport } = await connectMirror()
      await vi.advanceTimersByTimeAsync(2_000)

      const intents = runtimeCall.mock.calls
        .map(([request]) => request as { method: string; params?: { intent?: string } })
        .filter((request) => request.method === 'session.tabs.activate')
        .map((request) => request.params?.intent)
      expect(intents.length).toBeGreaterThan(1)
      expect(intents[0]).toBe('user')
      expect(intents.slice(1)).toEqual(intents.slice(1).map(() => 'automatic'))
      transport.destroy?.()
    } finally {
      vi.useRealTimers()
    }
  })

  it('lands a host that never republishes the tab on the revivable disconnected state', async () => {
    vi.useFakeTimers()
    try {
      const rehydratedRuntimeCall = runtimeCall.getMockImplementation()!
      runtimeCall.mockImplementation(async (request: { method: string }) =>
        request.method === 'session.tabs.activate' || request.method === 'session.tabs.list'
          ? missingHostTabResponse()
          : rehydratedRuntimeCall(request)
      )

      const { transport, onError } = await connectMirror()
      await vi.advanceTimersByTimeAsync(120_000)

      expect(transport.isConnected()).toBe(false)
      // 'disconnected' renders the reconnect banner and answers retryRecovery; 'offline' answers nothing.
      expect(transport.getRecoveryState?.().phase).toBe('disconnected')
      expect(onError).not.toHaveBeenCalled()

      runtimeCall.mockImplementation(rehydratedRuntimeCall)
      expect(transport.retryRecovery?.()).toBe(true)
      await vi.advanceTimersByTimeAsync(1_000)
      emitSnapshot(latestSubscribePayload().streamId, 'READY')
      expect(transport.isConnected()).toBe(true)
      transport.destroy?.()
    } finally {
      vi.useRealTimers()
    }
  })
})
