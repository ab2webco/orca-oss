import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetRuntimeTerminalViewAttributesForTest,
  publishTerminalViewAttributesToActiveRuntime
} from './runtime-terminal-view-attributes'
import type { TerminalViewAttributes } from '../../../shared/terminal-view-attributes'

const callRuntimeRpc = vi.hoisted(() => vi.fn(() => Promise.resolve({ published: true })))
const state = vi.hoisted(() => ({ env: null as string | null }))
const subscribers = vi.hoisted(() => [] as (() => void)[])

vi.mock('./runtime-rpc-client', () => ({
  callRuntimeRpc,
  getActiveRuntimeTarget: (s: { activeRuntimeEnvironmentId?: string | null }) =>
    s.activeRuntimeEnvironmentId
      ? { kind: 'environment', environmentId: s.activeRuntimeEnvironmentId }
      : { kind: 'local' }
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ settings: { activeRuntimeEnvironmentId: state.env } }),
    subscribe: (fn: () => void) => {
      subscribers.push(fn)
      return () => {}
    }
  }
}))

function setActiveEnvironment(id: string | null): void {
  state.env = id
  for (const fn of subscribers) {
    fn()
  }
}

const ATTRIBUTES = {
  foreground: [200, 200, 200],
  background: [40, 44, 52],
  cursor: [255, 255, 255],
  ansi: Array.from({ length: 256 }, () => [0, 0, 0]),
  colorSchemeMode: 'dark',
  cursorStyle: 'block',
  cursorBlink: false
} as unknown as TerminalViewAttributes

beforeEach(() => {
  callRuntimeRpc.mockClear()
  subscribers.length = 0
  state.env = null
  _resetRuntimeTerminalViewAttributesForTest()
})

describe('publishTerminalViewAttributesToActiveRuntime', () => {
  it('pushes the palette to the server that owns the terminals', () => {
    state.env = 'env-1'

    publishTerminalViewAttributesToActiveRuntime(ATTRIBUTES)

    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-1' },
      'terminal.publishViewAttributes',
      ATTRIBUTES,
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })

  it('stays quiet when this desktop owns the terminals', () => {
    publishTerminalViewAttributesToActiveRuntime(ATTRIBUTES)

    expect(callRuntimeRpc).not.toHaveBeenCalled()
  })

  // Why this is the case that matters: the renderer composes the palette on an
  // appearance change and dedupes identical snapshots, so connecting to a
  // server produces no new call. Without this replay that server keeps an empty
  // palette all session — and a silent OSC responder does not just stay quiet,
  // it swallows the query, leaving a TUI that asked for the background colour
  // waiting forever.
  it('replays the palette to a server connected after the last appearance change', () => {
    publishTerminalViewAttributesToActiveRuntime(ATTRIBUTES)
    expect(callRuntimeRpc).not.toHaveBeenCalled()

    setActiveEnvironment('env-late')

    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-late' },
      'terminal.publishViewAttributes',
      ATTRIBUTES,
      expect.anything()
    )
  })

  it('sends once per server, then again when a different one becomes active', () => {
    state.env = 'env-1'
    publishTerminalViewAttributesToActiveRuntime(ATTRIBUTES)
    publishTerminalViewAttributesToActiveRuntime(ATTRIBUTES)
    expect(callRuntimeRpc).toHaveBeenCalledTimes(1)

    setActiveEnvironment('env-2')

    expect(callRuntimeRpc).toHaveBeenCalledTimes(2)
    expect(callRuntimeRpc).toHaveBeenLastCalledWith(
      { kind: 'environment', environmentId: 'env-2' },
      'terminal.publishViewAttributes',
      ATTRIBUTES,
      expect.anything()
    )
  })
})
