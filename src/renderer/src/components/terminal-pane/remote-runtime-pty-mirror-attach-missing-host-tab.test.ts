import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRemoteRuntimeTransportMocks,
  readyHostSessionInventoryResponse,
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

// A host mid-rehydration rejects the activation for a tab it has not restored yet, and its worktree
// inventory simply does not list that tab.
function rehydratingHostResponse(method: string): unknown {
  if (method === 'session.tabs.activate') {
    return { ok: false, error: { code: 'tab_not_found', message: 'tab_not_found' } }
  }
  if (method === 'session.tabs.list') {
    return {
      ok: true,
      result: {
        worktree: 'wt-1',
        publicationEpoch: 'epoch-rehydrating',
        snapshotVersion: 1,
        activeGroupId: null,
        activeTabId: null,
        activeTabType: null,
        tabs: []
      }
    }
  }
  return null
}

function rehydratedHostResponse(method: string): unknown {
  return method === 'session.tabs.list'
    ? readyHostSessionInventoryResponse('terminal-1', 'host-tab-1')
    : null
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

  it('picks the tab up one poll interval after the host republishes it', async () => {
    vi.useFakeTimers()
    try {
      const healthyRuntimeCall = runtimeCall.getMockImplementation()!
      let rehydrated = false
      runtimeCall.mockImplementation(async (request: { method: string }) => {
        const staged = rehydrated
          ? rehydratedHostResponse(request.method)
          : rehydratingHostResponse(request.method)
        return staged ?? healthyRuntimeCall(request)
      })

      const { transport, onError } = await connectMirror()
      await vi.advanceTimersByTimeAsync(3_000)

      // Retiring the pane here left it at 'offline' with an idle recovery: no timer, no parked retry.
      expect(transport.getRecoveryState?.().phase).not.toBe('offline')
      expect(onError).not.toHaveBeenCalled()

      rehydrated = true
      // Well inside the backoff tier a ladder-only retry would still be parked on.
      await vi.advanceTimersByTimeAsync(400)
      emitSnapshot(latestSubscribePayload().streamId, 'READY')

      expect(transport.isConnected()).toBe(true)
      expect(transport.getPtyId()).toBe('remote:env-1@@terminal-1')
      expect(onError).not.toHaveBeenCalled()
      transport.destroy?.()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the wake intent on every retry so a slept pane still materializes', async () => {
    vi.useFakeTimers()
    try {
      const healthyRuntimeCall = runtimeCall.getMockImplementation()!
      runtimeCall.mockImplementation(
        async (request: { method: string }) =>
          rehydratingHostResponse(request.method) ?? healthyRuntimeCall(request)
      )

      const { transport } = await connectMirror()
      await vi.advanceTimersByTimeAsync(20_000)

      // The host refuses an automatic activation for a deliberately parked pane, so a retry that
      // downgrades the intent abandons the wake gesture it exists to complete.
      const intents = runtimeCall.mock.calls
        .map(([request]) => request as { method: string; params?: { intent?: string } })
        .filter((request) => request.method === 'session.tabs.activate')
        .map((request) => request.params?.intent)
      expect(intents.length).toBeGreaterThan(1)
      expect(intents).toEqual(intents.map(() => 'user'))
      transport.destroy?.()
    } finally {
      vi.useRealTimers()
    }
  })

  it('lands a host that never republishes the tab on the revivable disconnected state', async () => {
    vi.useFakeTimers()
    try {
      const healthyRuntimeCall = runtimeCall.getMockImplementation()!
      let rehydrated = false
      runtimeCall.mockImplementation(async (request: { method: string }) => {
        const staged = rehydrated
          ? rehydratedHostResponse(request.method)
          : rehydratingHostResponse(request.method)
        return staged ?? healthyRuntimeCall(request)
      })

      const { transport, onError } = await connectMirror()
      await vi.advanceTimersByTimeAsync(120_000)

      expect(transport.isConnected()).toBe(false)
      // 'disconnected' renders the reconnect banner and answers retryRecovery; 'offline' answers nothing.
      expect(transport.getRecoveryState?.().phase).toBe('disconnected')
      expect(onError).not.toHaveBeenCalled()

      rehydrated = true
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
