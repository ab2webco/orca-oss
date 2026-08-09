import { describe, expect, it } from 'vitest'
import { AgentComposerReadinessTracker, composerReadySignalFor } from './agent-composer-readiness'

const BRACKETED_PASTE_ON = '\x1b[?2004h'
const SHOW_CURSOR = '\x1b[?25h'
const PTY = 'pty_1'

/** Minimal stand-in for the runtime's per-PTY data fan-out. */
function createPtyBus(): {
  subscribe: (ptyId: string, listener: (data: string) => void) => () => void
  emit: (ptyId: string, data: string) => void
  listenerCount: (ptyId: string) => number
} {
  const listeners = new Map<string, Set<(data: string) => void>>()
  return {
    subscribe(ptyId, listener) {
      let set = listeners.get(ptyId)
      if (!set) {
        set = new Set()
        listeners.set(ptyId, set)
      }
      set.add(listener)
      return () => {
        set?.delete(listener)
      }
    },
    emit(ptyId, data) {
      for (const listener of listeners.get(ptyId) ?? []) {
        listener(data)
      }
    },
    listenerCount(ptyId) {
      return listeners.get(ptyId)?.size ?? 0
    }
  }
}

describe('composerReadySignalFor', () => {
  it('maps only agents whose readiness can be proven from the byte stream', () => {
    expect(composerReadySignalFor('codex')).toBe('codex-composer-prompt')
    expect(composerReadySignalFor('opencode')).toBe('render-cursor-after-bracketed-paste')
    expect(composerReadySignalFor('mimo-code')).toBe('render-cursor-after-bracketed-paste')
    // Why: Claude, Gemini, Droid and Cursor have no marker in the byte stream.
    // Inventing one would be a heuristic dressed as evidence.
    expect(composerReadySignalFor('claude')).toBeNull()
    expect(composerReadySignalFor('gemini')).toBeNull()
    expect(composerReadySignalFor('droid')).toBeNull()
    expect(composerReadySignalFor(null)).toBeNull()
  })
})

describe('AgentComposerReadinessTracker (ORCA-191)', () => {
  function watchedTracker(bus: ReturnType<typeof createPtyBus>) {
    const tracker = new AgentComposerReadinessTracker(bus.subscribe)
    tracker.beginObserving(PTY)
    return tracker
  }

  it('answers unobserved for an agent whose readiness it cannot prove', () => {
    const bus = createPtyBus()
    const tracker = watchedTracker(bus)
    tracker.observe(PTY, `${BRACKETED_PASTE_ON}› `)
    // Claude has no marker in the byte stream; the same bytes that prove Codex
    // ready prove nothing about it.
    expect(tracker.state(PTY, 'claude')).toBe('unobserved')
  })

  // Why: this is the bug the live rig found. `launchAgent` is only recorded for
  // token-bound spawns and `foregroundAgent` is refreshed lazily, so a booting
  // pane is usually unidentifiable at the moment its bracketed-paste enable
  // arrives. Observation must not depend on knowing the agent yet.
  it('observes a pane whose agent is not identifiable until after it booted', () => {
    const bus = createPtyBus()
    const tracker = watchedTracker(bus)
    tracker.observe(PTY, BRACKETED_PASTE_ON)
    tracker.observe(PTY, '\r\n› ')
    expect(tracker.state(PTY, 'codex')).toBe('ready')
  })

  // Why: a pane this runtime never registered was restored or adopted after a
  // restart. Its handshake happened where nothing was watching, so refusing
  // there would break `dispatch --inject`, the rescue path for a stalled run.
  it('answers unobserved for a pane it never began watching', () => {
    const bus = createPtyBus()
    const tracker = new AgentComposerReadinessTracker(bus.subscribe)
    tracker.observe(PTY, `${BRACKETED_PASTE_ON}› `)
    expect(tracker.state(PTY, 'codex')).toBe('unobserved')
  })

  it('tracks an opencode pane on its own show-cursor marker', () => {
    const bus = createPtyBus()
    const tracker = watchedTracker(bus)
    tracker.observe(PTY, BRACKETED_PASTE_ON)
    expect(tracker.state(PTY, 'opencode')).toBe('awaiting-composer')
    tracker.observe(PTY, SHOW_CURSOR)
    expect(tracker.state(PTY, 'opencode')).toBe('ready')
    // The same stream leaves Codex unready — one observation, per-agent answers.
    expect(tracker.state(PTY, 'codex')).toBe('awaiting-composer')
  })

  // Why: this is the incident's window. `tui-idle` is satisfied while Codex is
  // still repainting its boot screen — before it has even enabled bracketed
  // paste — so "no handshake yet" on a watched pane must read as not ready.
  it('tracks a codex pane from before its handshake to its composer prompt', () => {
    const bus = createPtyBus()
    const tracker = watchedTracker(bus)
    tracker.observe(PTY, '\x1b[2J\x1b[H Starting MCP server')
    expect(tracker.state(PTY, 'codex')).toBe('unobserved')
    tracker.observe(PTY, BRACKETED_PASTE_ON)
    expect(tracker.state(PTY, 'codex')).toBe('awaiting-composer')
    tracker.observe(PTY, '\r\n› ')
    expect(tracker.state(PTY, 'codex')).toBe('ready')
    expect(tracker.readyAt(PTY, 'codex')).not.toBeNull()
  })

  it('forgets a PTY so a reused id cannot inherit a stale ready latch', () => {
    const bus = createPtyBus()
    const tracker = watchedTracker(bus)
    tracker.observe(PTY, `${BRACKETED_PASTE_ON}› `)
    expect(tracker.state(PTY, 'codex')).toBe('ready')
    tracker.forget(PTY)
    expect(tracker.state(PTY, 'codex')).toBe('unobserved')
  })

  describe('wait', () => {
    it('resolves immediately for an agent with no provable marker', async () => {
      const bus = createPtyBus()
      const tracker = watchedTracker(bus)
      const readiness = await tracker.wait(PTY, 'claude', 60_000)
      expect(readiness).toMatchObject({ ready: true, proven: false, state: 'unobserved' })
      expect(bus.listenerCount(PTY)).toBe(0)
    })

    // Why: `dispatch --inject` is the rescue path for an already-stalled run and
    // it targets a pane this runtime may have adopted after a restart. Waiting
    // there would block on evidence that cannot exist; refusing would remove the
    // only way out of the state the ticket is about.
    it('resolves immediately for a pane it never began watching', async () => {
      const bus = createPtyBus()
      const tracker = new AgentComposerReadinessTracker(bus.subscribe)
      const readiness = await tracker.wait(PTY, 'codex', 60_000)
      expect(readiness).toMatchObject({ ready: true, proven: false, state: 'unobserved' })
      expect(bus.listenerCount(PTY)).toBe(0)
    })

    it('resolves immediately for a pane whose composer became ready earlier', async () => {
      const bus = createPtyBus()
      const tracker = watchedTracker(bus)
      tracker.observe(PTY, `${BRACKETED_PASTE_ON}› `)
      const readiness = await tracker.wait(PTY, 'codex', 60_000)
      expect(readiness).toMatchObject({ ready: true, proven: true, state: 'ready' })
    })

    // Why: this is the incident's window. `tui-idle` was satisfied here, while
    // Codex was still repainting its boot screen and had not yet enabled
    // bracketed paste — the gate has to keep waiting through all of it.
    it('waits from before the handshake and resolves on the marker', async () => {
      const bus = createPtyBus()
      const tracker = watchedTracker(bus)
      bus.subscribe(PTY, (data) => tracker.observe(PTY, data))
      const pending = tracker.wait(PTY, 'codex', 60_000)
      expect(bus.listenerCount(PTY)).toBe(2)
      bus.emit(PTY, '\x1b[2J\x1b[H Starting MCP server')
      bus.emit(PTY, BRACKETED_PASTE_ON)
      bus.emit(PTY, '\r\n› ')
      await expect(pending).resolves.toMatchObject({
        ready: true,
        proven: true,
        state: 'ready'
      })
      // Why: a waiter that outlives its wait leaks a listener on every dispatch.
      expect(bus.listenerCount(PTY)).toBe(1)
    })

    // Why: the budget bounds the wait, it does not authorise a refusal. A
    // dispatch that waited and never got proof still goes out — slice 1's
    // first-signal deadline is what catches a preamble that went nowhere.
    it('bounds the wait and still proceeds when the budget expires', async () => {
      const bus = createPtyBus()
      const tracker = watchedTracker(bus)
      tracker.observe(PTY, BRACKETED_PASTE_ON)
      const readiness = await tracker.wait(PTY, 'codex', 5)
      expect(readiness).toMatchObject({
        ready: true,
        proven: false,
        state: 'awaiting-composer'
      })
      expect(readiness.waitedMs).toBeGreaterThanOrEqual(0)
      expect(bus.listenerCount(PTY)).toBe(0)
    })

    // Why (E2E regression): three orchestration E2E specs died with a bare
    // shell prompt and no dispatch row because the gate refused a pane whose
    // marker was never coming. Measured on 2026-08-09: an interactive shell
    // emits DECSET 2004 for its own prompt, real Codex emits it twice, and a
    // `codex`-named non-TUI emits it zero times — so nothing before the marker
    // separates "mid-boot" from "will never mount a composer".
    it('proceeds unproven when the marker never arrives', async () => {
      const bus = createPtyBus()
      const tracker = watchedTracker(bus)
      bus.subscribe(PTY, (data) => tracker.observe(PTY, data))
      // The shell's own handshake, then a process that is not the TUI.
      tracker.observe(PTY, BRACKETED_PASTE_ON)
      tracker.observe(PTY, '\x1b]0;Codex Ready\x07OpenAI Codex\nmodel: e2e\n')

      await expect(tracker.wait(PTY, 'codex', 20)).resolves.toMatchObject({
        ready: true,
        proven: false,
        state: 'awaiting-composer'
      })
      expect(bus.listenerCount(PTY)).toBe(1)
    })

    it('proceeds proven when the marker arrives inside the budget', async () => {
      const bus = createPtyBus()
      const tracker = watchedTracker(bus)
      bus.subscribe(PTY, (data) => tracker.observe(PTY, data))
      const pending = tracker.wait(PTY, 'codex', 60_000)
      bus.emit(PTY, BRACKETED_PASTE_ON)
      bus.emit(PTY, '\x1b[2J\x1b[H Starting MCP server')
      bus.emit(PTY, '\r\n› ')

      await expect(pending).resolves.toMatchObject({
        ready: true,
        proven: true,
        state: 'ready'
      })
      expect(bus.listenerCount(PTY)).toBe(1)
    })

    it('stops waiting when the request is aborted', async () => {
      const bus = createPtyBus()
      const tracker = watchedTracker(bus)
      const abort = new AbortController()
      const pending = tracker.wait(PTY, 'codex', 60_000, { abortSignal: abort.signal })
      abort.abort()
      await expect(pending).resolves.toMatchObject({ state: 'unobserved' })
      expect(bus.listenerCount(PTY)).toBe(0)
    })
  })

  describe('observeTurnAcceptance', () => {
    it('ignores output produced before the write is armed', async () => {
      const bus = createPtyBus()
      const tracker = new AgentComposerReadinessTracker(bus.subscribe)
      const observer = tracker.observeTurnAcceptance(PTY, 20)
      // Why: causality comes from which chunks are fed, not from clock
      // comparison — a working banner already on screen is not this turn.
      bus.emit(PTY, 'Working (12s • esc to interrupt)')
      const acceptance = await observer.arm()
      expect(acceptance).toMatchObject({ accepted: false, evidence: null })
    })

    it('accepts on the agent’s first reaction after the write', async () => {
      const bus = createPtyBus()
      const tracker = new AgentComposerReadinessTracker(bus.subscribe)
      const observer = tracker.observeTurnAcceptance(PTY, 60_000)
      const pending = observer.arm()
      bus.emit(PTY, 'Working (0s • esc to interrupt)')
      await expect(pending).resolves.toMatchObject({
        accepted: true,
        evidence: 'interrupt-affordance'
      })
      expect(bus.listenerCount(PTY)).toBe(0)
    })

    it('unsubscribes when the write threw and the observation is cancelled', () => {
      const bus = createPtyBus()
      const tracker = new AgentComposerReadinessTracker(bus.subscribe)
      const observer = tracker.observeTurnAcceptance(PTY, 60_000)
      expect(bus.listenerCount(PTY)).toBe(1)
      observer.cancel()
      expect(bus.listenerCount(PTY)).toBe(0)
    })
  })
})
