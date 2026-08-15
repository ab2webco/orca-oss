import { describe, expect, it, vi } from 'vitest'
import { DaemonPtyRouter } from './daemon-pty-router'
import { createAdapter } from './daemon-pty-router-test-adapters'

// Split out of daemon-pty-router.test.ts: the merged file crossed the 800-line
// cap. Restart accessors and disposeRouterOnly are one contract.
describe('DaemonPtyRouter restart lifecycle', () => {
  // Why: docs/daemon-staleness-ux.md §Phase 1 step 5 requires the restart flow
  // to preserve the legacy adapter instances across the current-adapter swap,
  // and it reads them back via these accessors. Locking the return shape
  // prevents a future refactor from quietly switching to a defensive copy
  // (breaks instance identity) or a different list (breaks restart).
  describe('restart accessors', () => {
    it('returns the exact current adapter instance', () => {
      const current = createAdapter('current')
      const router = new DaemonPtyRouter({ current, legacy: [] })

      expect(router.getCurrentAdapter()).toBe(current)
    })

    it('returns the exact legacy adapter instances', () => {
      const current = createAdapter('current')
      const legacy1 = createAdapter('legacy-1')
      const legacy2 = createAdapter('legacy-2')
      const router = new DaemonPtyRouter({ current, legacy: [legacy1, legacy2] })

      const legacies = router.getLegacyAdapters()
      expect(legacies.length).toBe(2)
      expect(legacies[0]).toBe(legacy1)
      expect(legacies[1]).toBe(legacy2)
    })

    it('getAllAdapters returns current first then legacy, by identity', () => {
      const current = createAdapter('current')
      const legacy1 = createAdapter('legacy-1')
      const legacy2 = createAdapter('legacy-2')
      const router = new DaemonPtyRouter({ current, legacy: [legacy1, legacy2] })

      const all = router.getAllAdapters()
      expect(all.length).toBe(3)
      expect(all[0]).toBe(current)
      expect(all[1]).toBe(legacy1)
      expect(all[2]).toBe(legacy2)
    })
  })

  // Why: the restart flow (daemon-init.runRestartDaemon step 5→6) relies on
  // disposeRouterOnly draining the outgoing router's subscriptions WITHOUT
  // tearing down the legacy adapters themselves. plain dispose() would
  // cascade into the adapters and strand any legacy-backed sessions — see
  // daemon-pty-router.ts §disposeRouterOnly comment. These tests lock the
  // contract: no adapter teardown, subscriptions actually detached for both
  // onData and onExit on both current and legacy, idempotent.
  describe('disposeRouterOnly', () => {
    it('does not call dispose or disconnectOnly on any adapter', () => {
      const current = createAdapter('current')
      const legacy = createAdapter('legacy')
      const router = new DaemonPtyRouter({ current, legacy: [legacy] })

      router.disposeRouterOnly()

      expect(current.dispose).not.toHaveBeenCalled()
      expect(legacy.dispose).not.toHaveBeenCalled()
      expect(current.disconnectOnly).not.toHaveBeenCalled()
      expect(legacy.disconnectOnly).not.toHaveBeenCalled()
    })

    it('stops forwarding adapter onData/onExit to subscribers registered before dispose', () => {
      const current = createAdapter('current')
      const legacy = createAdapter('legacy')
      const router = new DaemonPtyRouter({ current, legacy: [legacy] })

      // Realistic restart scenario: the local IPC layer subscribes at app
      // start, THEN the restart flow later calls disposeRouterOnly. A spy
      // registered *after* dispose proves the router→subscriber path is
      // empty, but doesn't prove the router unsubscribed from the adapters.
      const dataSpy = vi.fn()
      const exitSpy = vi.fn()
      router.onData(dataSpy)
      router.onExit(exitSpy)

      router.disposeRouterOnly()

      // Both current- and legacy-adapter emissions must be silenced. A
      // regression that only unsubscribed from one would pass a single-
      // adapter test but fail this one.
      current.emitData('current-id', 'hello')
      current.emitExit('current-id', 0)
      legacy.emitData('legacy-id', 'world')
      legacy.emitExit('legacy-id', 1)

      expect(dataSpy).not.toHaveBeenCalled()
      expect(exitSpy).not.toHaveBeenCalled()
    })

    it('is idempotent — a second disposeRouterOnly call is a no-op and does not throw', () => {
      const current = createAdapter('current')
      const legacy = createAdapter('legacy')
      const router = new DaemonPtyRouter({ current, legacy: [legacy] })

      router.disposeRouterOnly()
      expect(() => router.disposeRouterOnly()).not.toThrow()
      // And still no adapter teardown on the second call.
      expect(current.dispose).not.toHaveBeenCalled()
      expect(legacy.dispose).not.toHaveBeenCalled()
    })
  })
})
