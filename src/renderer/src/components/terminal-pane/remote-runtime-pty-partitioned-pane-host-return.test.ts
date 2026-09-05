import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRemoteRuntimeTransportMocks,
  type MultiplexSubscriptionCallbacks
} from './remote-runtime-pty-transport-test-harness'
import type { RuntimeMobileSessionTabsResult } from '../../../../shared/runtime-types'

let subscriptionCallbacks: MultiplexSubscriptionCallbacks = null
let resolvedPaneHandle = 'terminal-1'

const {
  runtimeCall,
  runtimeSubscribe,
  subscriptionSendBinary,
  emitSnapshot,
  latestSubscribePayload,
  subscribedTerminalHandles,
  resetRemoteRuntimeTransport
} = createRemoteRuntimeTransportMocks({
  getCallbacks: () => subscriptionCallbacks,
  setCallbacks: (callbacks) => {
    subscriptionCallbacks = callbacks
  },
  getResolvedPaneHandle: () => resolvedPaneHandle,
  setResolvedPaneHandle: (handle) => {
    resolvedPaneHandle = handle
  }
})

function hostSnapshot(
  snapshotVersion: number,
  publicationEpoch: string
): RuntimeMobileSessionTabsResult {
  return {
    worktree: 'wt-1',
    publicationEpoch,
    snapshotVersion,
    activeGroupId: null,
    activeTabId: 'host-tab-1::pane:1',
    activeTabType: 'terminal',
    tabs: [
      {
        type: 'terminal',
        id: 'host-tab-1::pane:1',
        parentTabId: 'host-tab-1',
        leafId: 'pane:1',
        title: 'Terminal',
        isActive: true,
        status: 'ready',
        terminal: 'terminal-1'
      }
    ]
  }
}

function hostUnavailableError(): Error {
  return Object.assign(new Error('Could not connect to the remote Orca runtime.'), {
    code: 'remote_runtime_unavailable'
  })
}

describe('remote runtime pty recovery when a partitioned host starts serving again', () => {
  beforeEach(() => {
    resetRemoteRuntimeTransport()
  })

  async function attachConnectedMirror() {
    const { createRemoteRuntimePtyTransport } = await import('./remote-runtime-pty-transport')
    const onError = vi.fn()
    const transport = createRemoteRuntimePtyTransport('env-1', {
      worktreeId: 'wt-1',
      tabId: 'web-terminal-host-tab-1',
      leafId: 'pane:1'
    })
    transport.attach({
      existingPtyId: 'remote:env-1@@terminal-1',
      cols: 80,
      rows: 24,
      callbacks: { onError }
    })
    await vi.waitFor(() => expect(subscriptionSendBinary).toHaveBeenCalled())
    emitSnapshot(latestSubscribePayload().streamId, 'READY')
    expect(transport.isConnected()).toBe(true)
    return { transport, onError }
  }

  it('reattaches as soon as the relaunched host republishes the surface it is parked on', async () => {
    vi.useFakeTimers()
    try {
      const healthyRuntimeCall = runtimeCall.getMockImplementation()
      const healthyRuntimeSubscribe = runtimeSubscribe.getMockImplementation()
      const { transport, onError } = await attachConnectedMirror()
      const handleEvents = await import('../../runtime/web-session-terminal-handle-events')

      runtimeCall.mockImplementation(async () => {
        throw hostUnavailableError()
      })
      runtimeSubscribe.mockImplementation(async () => {
        throw hostUnavailableError()
      })
      subscriptionCallbacks?.onError?.({
        code: 'remote_runtime_unavailable',
        message: 'Remote runtime connection closed.'
      })

      await vi.advanceTimersByTimeAsync(31_000)
      expect(transport.isConnected()).toBe(false)
      expect(transport.getRecoveryState?.().phase).not.toBe('disconnected')
      expect(handleEvents.getWebSessionTerminalHandleSubscriberCountForTests()).toBe(1)
      expect(subscribedTerminalHandles()).toHaveLength(1)

      runtimeCall.mockImplementation(healthyRuntimeCall!)
      runtimeSubscribe.mockImplementation(healthyRuntimeSubscribe!)
      handleEvents.queueAcceptedWebSessionTerminalSnapshot(hostSnapshot(2, 'epoch-2'), 'env-1')
      await vi.advanceTimersByTimeAsync(1_000)

      expect(subscribedTerminalHandles()).toEqual(['terminal-1', 'terminal-1'])
      emitSnapshot(latestSubscribePayload().streamId, 'reattached')
      expect(transport.isConnected()).toBe(true)
      expect(transport.getPtyId()).toBe('remote:env-1@@terminal-1')
      expect(onError).not.toHaveBeenCalled()
      transport.destroy?.()
    } finally {
      vi.useRealTimers()
    }
  })

  it('restarts the backoff ladder when the reconnect-triggered attempt loses the race', async () => {
    vi.useFakeTimers()
    try {
      const { transport } = await attachConnectedMirror()
      const handleEvents = await import('../../runtime/web-session-terminal-handle-events')

      runtimeCall.mockImplementation(async () => {
        throw hostUnavailableError()
      })
      runtimeSubscribe.mockImplementation(async () => {
        throw hostUnavailableError()
      })
      subscriptionCallbacks?.onError?.({
        code: 'remote_runtime_unavailable',
        message: 'Remote runtime connection closed.'
      })

      await vi.advanceTimersByTimeAsync(31_000)
      const parkedEpoch = transport.getRecoveryState?.().epoch ?? 0
      const callsWhileParked = runtimeCall.mock.calls.length
      expect(transport.getRecoveryState?.().attempt).toBeGreaterThan(0)

      handleEvents.queueAcceptedWebSessionTerminalSnapshot(hostSnapshot(2, 'epoch-2'), 'env-1')
      await vi.advanceTimersByTimeAsync(0)

      const revived = transport.getRecoveryState?.()
      expect(runtimeCall.mock.calls.length).toBeGreaterThan(callsWhileParked)
      expect(revived?.phase).toBe('recovering')
      expect(revived?.attempt).toBe(0)
      expect(revived?.epoch).toBe(parkedEpoch)
      transport.destroy?.()
    } finally {
      vi.useRealTimers()
    }
  })
})
