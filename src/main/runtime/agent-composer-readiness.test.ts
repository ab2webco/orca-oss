import { describe, expect, it } from 'vitest'
import { AgentComposerReadinessTracker, composerReadySignalFor } from './agent-composer-readiness'

const BRACKETED_PASTE_ON = '\x1b[?2004h'
const BRACKETED_PASTE_OFF = '\x1b[?2004l'
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
    // Why (ORCA-208): Claude does carry a marker — measured on a real v2.1.229
    // PTY, the DECTCEM show-cursor lands only once the composer row is drawn
    // and the cursor is placed in it. Leaving it null was a configuration gap,
    // not a property of the agent, and it made every Claude dispatch ungated.
    expect(composerReadySignalFor('claude')).toBe('render-cursor-after-bracketed-paste')
    // Why: Gemini, Droid and Cursor still have no measured marker. Inventing
    // one would be a heuristic dressed as evidence.
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
    // Gemini has no marker in the byte stream; the same bytes that prove Codex
    // ready prove nothing about it.
    expect(tracker.state(PTY, 'gemini')).toBe('unobserved')
  })

  // Why (ORCA-208): the exact stream a real `claude` v2.1.229 emits — one
  // DECSET 2004, the composer row, the cursor placed inside it, then the
  // show-cursor. Before the signal was configured this pane answered
  // `unobserved` forever, so `wait --for composer-ready` could never be
  // satisfied on a live Claude composer and every Claude dispatch was written
  // with no readiness proof at all.
  it('tracks a claude pane to the cursor placed in its composer', () => {
    const bus = createPtyBus()
    const tracker = watchedTracker(bus)
    tracker.observe(PTY, `${BRACKETED_PASTE_ON}\x1b[?1004h\x1b[?2031h\x1b]0;✳ Claude Code\x07`)
    expect(tracker.state(PTY, 'claude')).toBe('awaiting-composer')
    tracker.observe(PTY, `❯\xa0Try "edit …"\x1b[40;1H\x1b[36;3H${SHOW_CURSOR}`)
    expect(tracker.state(PTY, 'claude')).toBe('ready')
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
      const readiness = await tracker.wait(PTY, 'gemini', 60_000)
      expect(readiness).toMatchObject({ ready: true, proven: false, state: 'unobserved' })
      expect(bus.listenerCount(PTY)).toBe(0)
    })

    // Why (ORCA-208): the inspection surface the user hit. Before Claude
    // carried a signal this resolved `proven: false` in 0 ms against a composer
    // that was drawn and accepting input — a false negative no caller could
    // distinguish from a pane that never became ready.
    it('proves a claude composer instead of answering unobserved in 0 ms', async () => {
      const bus = createPtyBus()
      const tracker = watchedTracker(bus)
      const pending = tracker.wait(PTY, 'claude', 60_000, { holdWithoutPendingMarker: true })
      bus.emit(PTY, BRACKETED_PASTE_ON)
      tracker.observe(PTY, BRACKETED_PASTE_ON)
      tracker.observe(PTY, SHOW_CURSOR)
      bus.emit(PTY, SHOW_CURSOR)
      expect(await pending).toMatchObject({ ready: true, proven: true, state: 'ready' })
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

    // Why: this is the incident's window. The agent enables bracketed paste
    // ~120 ms after launch (measured 2026-08-09) and only then repaints its
    // boot screen for seconds — `tui-idle` is satisfied inside that repaint,
    // and the gate has to keep waiting through all of it.
    it('waits through the boot repaint and resolves on the marker', async () => {
      const bus = createPtyBus()
      const tracker = watchedTracker(bus)
      bus.subscribe(PTY, (data) => tracker.observe(PTY, data))
      tracker.observe(PTY, BRACKETED_PASTE_ON)
      const pending = tracker.wait(PTY, 'codex', 60_000)
      expect(bus.listenerCount(PTY)).toBe(2)
      bus.emit(PTY, '\x1b[2J\x1b[H Starting MCP server')
      bus.emit(PTY, '\r\n› ')
      await expect(pending).resolves.toMatchObject({
        ready: true,
        proven: true,
        state: 'ready'
      })
      // Why: a waiter that outlives its wait leaks a listener on every dispatch.
      expect(bus.listenerCount(PTY)).toBe(1)
    })

    // Why (E2E regression): the handshake is the marker's own precondition, so
    // a pane that is not holding it has no marker pending and nothing to wait
    // for. Measured 2026-08-09: an interactive shell enables bracketed paste
    // for its own prompt and gives it back (DECRST 2004) when it runs a
    // command; codex and opencode re-enable it ~120 ms later, a `codex`-named
    // non-TUI never does. Holding the budget for the second case is what made
    // three orchestration E2E specs miss their own assertion window.
    it('does not spend the budget when no marker is pending', async () => {
      const bus = createPtyBus()
      const tracker = watchedTracker(bus)
      bus.subscribe(PTY, (data) => tracker.observe(PTY, data))
      tracker.observe(PTY, BRACKETED_PASTE_ON)
      tracker.observe(PTY, `codex\r\n${BRACKETED_PASTE_OFF}`)
      tracker.observe(PTY, '\x1b]0;Codex Ready\x07OpenAI Codex\nmodel: e2e\n')

      const readiness = await tracker.wait(PTY, 'codex', 60_000)
      expect(readiness).toMatchObject({ ready: true, proven: false, state: 'unobserved' })
      expect(readiness.waitedMs).toBeLessThan(1_000)
      expect(bus.listenerCount(PTY)).toBe(1)
    })

    // Why: the pane the agent is booting in gives the handshake back only when
    // its program hands the terminal on, so a wait that outlives that event is
    // waiting for a marker that has lost its precondition.
    it('stops waiting when the pane gives the handshake back', async () => {
      const bus = createPtyBus()
      const tracker = watchedTracker(bus)
      bus.subscribe(PTY, (data) => tracker.observe(PTY, data))
      tracker.observe(PTY, BRACKETED_PASTE_ON)
      const pending = tracker.wait(PTY, 'codex', 60_000)
      bus.emit(PTY, BRACKETED_PASTE_OFF)
      await expect(pending).resolves.toMatchObject({
        ready: true,
        proven: false,
        state: 'unobserved'
      })
      expect(bus.listenerCount(PTY)).toBe(1)
    })

    // Why: `wait --for composer-ready` asked to be told when the pane becomes
    // ready, so it may spend its own budget on a pane that has not started
    // mounting yet. The injector may not — that is the line above.
    it('holds for the inspection surface until the marker arrives', async () => {
      const bus = createPtyBus()
      const tracker = watchedTracker(bus)
      bus.subscribe(PTY, (data) => tracker.observe(PTY, data))
      const pending = tracker.wait(PTY, 'codex', 60_000, { holdWithoutPendingMarker: true })
      bus.emit(PTY, '\x1b[2J\x1b[H Starting MCP server')
      bus.emit(PTY, BRACKETED_PASTE_ON)
      bus.emit(PTY, '\r\n› ')
      await expect(pending).resolves.toMatchObject({
        ready: true,
        proven: true,
        state: 'ready'
      })
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
    // marker was never coming. Nothing before the marker proves a pane holding
    // the handshake will ever mount a composer, so expiry proceeds unproven.
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
      tracker.observe(PTY, BRACKETED_PASTE_ON)
      const pending = tracker.wait(PTY, 'codex', 60_000)
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
