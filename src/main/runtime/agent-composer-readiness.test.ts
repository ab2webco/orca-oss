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
  it('never allocates for an agent whose readiness it cannot prove', () => {
    const bus = createPtyBus()
    const tracker = new AgentComposerReadinessTracker(bus.subscribe)
    tracker.observe(PTY, 'claude', `${BRACKETED_PASTE_ON}› `)
    expect(tracker.state(PTY)).toBe('unobserved')
  })

  it('tracks an opencode pane on its own show-cursor marker', () => {
    const bus = createPtyBus()
    const tracker = new AgentComposerReadinessTracker(bus.subscribe)
    tracker.observe(PTY, 'opencode', BRACKETED_PASTE_ON)
    expect(tracker.state(PTY)).toBe('awaiting-composer')
    // Why: opencode stays silent ~1.5-2 s between enabling bracketed paste and
    // mounting its composer, which is why a quiet window cannot stand in here.
    tracker.observe(PTY, 'opencode', SHOW_CURSOR)
    expect(tracker.state(PTY)).toBe('ready')
  })

  it('tracks a codex pane from bracketed paste to composer prompt', () => {
    const bus = createPtyBus()
    const tracker = new AgentComposerReadinessTracker(bus.subscribe)
    tracker.observe(PTY, 'codex', 'starting')
    expect(tracker.state(PTY)).toBe('unobserved')
    tracker.observe(PTY, 'codex', BRACKETED_PASTE_ON)
    expect(tracker.state(PTY)).toBe('awaiting-composer')
    tracker.observe(PTY, 'codex', '\r\n› ')
    expect(tracker.state(PTY)).toBe('ready')
    expect(tracker.readyAt(PTY)).not.toBeNull()
  })

  it('forgets a PTY so a reused id cannot inherit a stale ready latch', () => {
    const bus = createPtyBus()
    const tracker = new AgentComposerReadinessTracker(bus.subscribe)
    tracker.observe(PTY, 'codex', `${BRACKETED_PASTE_ON}› `)
    expect(tracker.state(PTY)).toBe('ready')
    tracker.forget(PTY)
    expect(tracker.state(PTY)).toBe('unobserved')
  })

  describe('wait', () => {
    it('resolves immediately for an untracked pane instead of sleeping', async () => {
      const bus = createPtyBus()
      const tracker = new AgentComposerReadinessTracker(bus.subscribe)
      const readiness = await tracker.wait(PTY, 'claude', 60_000)
      expect(readiness).toMatchObject({ ready: true, proven: false, state: 'unobserved' })
      expect(bus.listenerCount(PTY)).toBe(0)
    })

    it('resolves immediately for a pane whose composer became ready earlier', async () => {
      const bus = createPtyBus()
      const tracker = new AgentComposerReadinessTracker(bus.subscribe)
      // Why: the `dispatch --inject` rescue path targets a long-established
      // pane. Its bracketed-paste enable is far out of any replay window, so a
      // per-send scanner would time out and refuse the one path that rescues a
      // stalled run.
      tracker.observe(PTY, 'codex', `${BRACKETED_PASTE_ON}› `)
      const readiness = await tracker.wait(PTY, 'codex', 60_000)
      expect(readiness).toMatchObject({ ready: true, proven: true, state: 'ready' })
    })

    it('waits through the boot window and resolves on the marker', async () => {
      const bus = createPtyBus()
      const tracker = new AgentComposerReadinessTracker(bus.subscribe)
      bus.subscribe(PTY, (data) => tracker.observe(PTY, 'codex', data))
      tracker.observe(PTY, 'codex', BRACKETED_PASTE_ON)
      const pending = tracker.wait(PTY, 'codex', 60_000)
      expect(bus.listenerCount(PTY)).toBe(2)
      bus.emit(PTY, '\x1b[2J still booting')
      bus.emit(PTY, '\r\n› ')
      await expect(pending).resolves.toMatchObject({
        ready: true,
        proven: true,
        state: 'ready'
      })
      // Why: a waiter that outlives its wait leaks a listener on every dispatch.
      expect(bus.listenerCount(PTY)).toBe(1)
    })

    it('refuses when the composer never arrives inside the budget', async () => {
      const bus = createPtyBus()
      const tracker = new AgentComposerReadinessTracker(bus.subscribe)
      tracker.observe(PTY, 'codex', BRACKETED_PASTE_ON)
      const readiness = await tracker.wait(PTY, 'codex', 5)
      expect(readiness).toMatchObject({
        ready: false,
        proven: false,
        state: 'awaiting-composer'
      })
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
