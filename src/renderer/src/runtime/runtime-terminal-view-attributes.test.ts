import { describe, expect, it, vi } from 'vitest'
import { publishTerminalViewAttributesToActiveRuntime } from './runtime-terminal-view-attributes'
import type { TerminalViewAttributes } from '../../../shared/terminal-view-attributes'

const callRuntimeRpc = vi.hoisted(() => vi.fn(() => Promise.resolve({ published: true })))
const settings = vi.hoisted(() => ({ value: null as string | null }))

vi.mock('./runtime-rpc-client', () => ({
  callRuntimeRpc,
  getActiveRuntimeTarget: (s: { activeRuntimeEnvironmentId?: string | null }) =>
    s.activeRuntimeEnvironmentId
      ? { kind: 'environment', environmentId: s.activeRuntimeEnvironmentId }
      : { kind: 'local' }
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ settings: { activeRuntimeEnvironmentId: settings.value } })
  }
}))

const ATTRIBUTES = {
  foreground: [200, 200, 200],
  background: [40, 44, 52],
  cursor: [255, 255, 255],
  ansi: Array.from({ length: 256 }, () => [0, 0, 0]),
  colorSchemeMode: 'dark',
  cursorStyle: 'block',
  cursorBlink: false
} as unknown as TerminalViewAttributes

describe('publishTerminalViewAttributesToActiveRuntime', () => {
  // Why this matters: with no palette the server's responder stays silent by
  // design, so every colour query round-trips to the client. Its reply lands
  // after the asking process is gone and the next reader gets `ESC ]`, which is
  // what kills an interactive prompt on a server-hosted terminal.
  it('pushes the palette to the server that owns the terminals', () => {
    settings.value = 'env-1'
    callRuntimeRpc.mockClear()

    publishTerminalViewAttributesToActiveRuntime(ATTRIBUTES)

    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-1' },
      'terminal.publishViewAttributes',
      ATTRIBUTES,
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })

  it('stays quiet when this desktop owns the terminals', () => {
    settings.value = null
    callRuntimeRpc.mockClear()

    publishTerminalViewAttributesToActiveRuntime(ATTRIBUTES)

    // The desktop already published over its own preload IPC.
    expect(callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('swallows an unreachable server instead of breaking an appearance apply', () => {
    settings.value = 'env-1'
    callRuntimeRpc.mockClear().mockRejectedValueOnce(new Error('offline'))

    expect(() => publishTerminalViewAttributesToActiveRuntime(ATTRIBUTES)).not.toThrow()
  })
})
