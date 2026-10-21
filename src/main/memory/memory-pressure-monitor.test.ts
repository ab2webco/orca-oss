import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MemoryPressurePane,
  MemoryPressureReading,
  MemoryPressureState,
  MemoryPressureWarning
} from '../../shared/memory-pressure-types'
import type { MemoryPressureWarningSettings } from '../../shared/memory-pressure-settings'
import { MemoryPressureMonitor } from './memory-pressure-monitor'
import {
  CACHE_HEAVY_MAC_HOUR,
  CACHE_SWING_MAC_HOUR,
  FLAT_LOW_MAC,
  GIB,
  TICK_MS,
  darwinSeries,
  linuxSeries,
  type DarwinSample
} from './memory-pressure-series.test-fixtures'

const MINUTE = 60_000

const PANE: MemoryPressurePane = {
  sessionId: 'pty-1',
  ptyId: 'pty-1',
  paneKey: 'tab-1:leaf-1',
  worktreeId: 'repo::/w',
  worktreeName: 'w',
  repoName: 'repo',
  memory: 2 * GIB,
  metric: 'phys-footprint',
  lastOutputAt: null
}

function ticksFor(ms: number): number {
  return Math.round(ms / TICK_MS)
}

function warnFor(ms: number, kernel: DarwinSample['kernel'] = 'warn'): DarwinSample[] {
  return Array.from({ length: ticksFor(ms) }, () => ({ level: 20, kernel }))
}

function normalFor(ms: number): DarwinSample[] {
  return Array.from({ length: ticksFor(ms) }, () => ({ level: 40 }))
}

function setup(series: MemoryPressureReading[]) {
  const readings = [...series]
  let settings: MemoryPressureWarningSettings = { enabled: true, thresholdPercent: 10 }
  const states: MemoryPressureState[] = []
  const readPressure = vi.fn(async () => {
    const next = readings.shift()
    if (!next) {
      throw new Error('series exhausted')
    }
    return next
  })
  const collectPanes = vi.fn(async () => [PANE])
  const monitor = new MemoryPressureMonitor({
    readPressure,
    collectPanes,
    getSettings: () => settings,
    broadcast: (state) => states.push(state),
    intervalMs: TICK_MS
  })
  // Why sweeping: every popup that opens or comes back is broadcast first with the sweep pending.
  const shown = (): MemoryPressureWarning[] =>
    states.flatMap((state) => (state.warning?.sweeping ? [state.warning] : []))
  return {
    monitor,
    readings,
    states,
    shown,
    readPressure,
    collectPanes,
    setSettings: (next: MemoryPressureWarningSettings) => {
      settings = next
    },
    tickAll: async () => {
      while (readings.length > 0) {
        await monitor.tick()
      }
    },
    tickN: async (count: number) => {
      for (let i = 0; i < count; i += 1) {
        await monitor.tick()
      }
    }
  }
}

describe('MemoryPressureMonitor', () => {
  describe('recorded series', () => {
    it('opens nothing over a cache-heavy macOS hour with high swap and kernel normal', async () => {
      const { tickAll, shown, states } = setup(darwinSeries(CACHE_HEAVY_MAC_HOUR))

      await tickAll()

      expect(shown()).toEqual([])
      expect(states).toEqual([])
    })

    it('opens nothing while the cache swings the level across the old exit line', async () => {
      const { tickAll, shown } = setup(darwinSeries(CACHE_SWING_MAC_HOUR))

      await tickAll()

      expect(shown()).toEqual([])
    })

    it('opens nothing on a flat low macOS level while the kernel stays normal', async () => {
      const { tickAll, shown } = setup(darwinSeries(FLAT_LOW_MAC))

      await tickAll()

      expect(shown()).toEqual([])
    })

    it('ignores a single kernel warn sample', async () => {
      const { tickAll, shown } = setup(
        darwinSeries([
          ...normalFor(MINUTE),
          { level: 20, kernel: 'warn' },
          ...normalFor(5 * MINUTE)
        ])
      )

      await tickAll()

      expect(shown()).toEqual([])
    })

    it('opens exactly one popup when kernel warn is sustained for the whole window', async () => {
      const { tickAll, shown, states, collectPanes } = setup(
        darwinSeries([...normalFor(MINUTE), ...warnFor(15 * MINUTE)])
      )

      await tickAll()

      expect(shown()).toHaveLength(1)
      expect(shown()[0]).toMatchObject({
        episodeId: 1,
        trigger: 'kernel-pressure',
        reading: { kernelLevel: 'warn' }
      })
      expect(collectPanes).toHaveBeenCalledTimes(1)
      expect(states.at(-1)?.warning).toMatchObject({
        episodeId: 1,
        trigger: 'kernel-pressure',
        panes: [PANE]
      })
    })

    it('waits the full two minutes of warn before opening', async () => {
      const { tickN, shown } = setup(darwinSeries(warnFor(10 * MINUTE)))

      await tickN(4)
      expect(shown()).toHaveLength(0)
      await tickN(1)
      expect(shown()).toHaveLength(1)
    })

    it('opens one popup for a kernel level that flaps between warn and normal', async () => {
      const flap = [
        ...warnFor(2.5 * MINUTE),
        { level: 40 },
        ...warnFor(1.5 * MINUTE),
        { level: 40 }
      ]
      const series = Array.from({ length: 6 }, () => flap).flat()
      const { tickAll, shown, monitor } = setup(darwinSeries(series))

      await tickAll()

      expect(shown()).toHaveLength(1)
      expect(monitor.getState().warning?.episodeId).toBe(1)
    })

    it('opens one popup for free memory flapping around the threshold on Linux', async () => {
      const series = linuxSeries([
        ...Array.from({ length: 6 }, () => 8),
        ...Array.from({ length: 30 }, (_, index) => (index % 2 === 0 ? 11 : 9))
      ])
      const { tickAll, shown } = setup(series)

      await tickAll()

      expect(shown()).toHaveLength(1)
      expect(shown()[0]).toMatchObject({ trigger: 'low-memory', reading: { source: 'meminfo' } })
    })
  })

  describe('episodes', () => {
    it('closes an episode only after ten clear minutes, not on one clear sample', async () => {
      const { tickN, monitor } = setup(
        darwinSeries([...warnFor(3 * MINUTE), ...normalFor(12 * MINUTE)])
      )

      await tickN(ticksFor(3 * MINUTE) + 1)
      expect(monitor.getState().warning).not.toBeNull()
      await tickN(ticksFor(9 * MINUTE))
      expect(monitor.getState().warning).not.toBeNull()
      await tickN(ticksFor(2 * MINUTE))
      expect(monitor.getState().warning).toBeNull()
    })

    it('does not reopen within thirty minutes of the last popup unless it is worse', async () => {
      const { tickAll, shown } = setup(
        darwinSeries([...warnFor(3 * MINUTE), ...normalFor(11 * MINUTE), ...warnFor(5 * MINUTE)])
      )

      await tickAll()

      expect(shown()).toHaveLength(1)
    })

    it('reopens within thirty minutes when the kernel level rises to critical', async () => {
      const { tickAll, shown } = setup(
        darwinSeries([
          ...warnFor(3 * MINUTE),
          ...normalFor(11 * MINUTE),
          ...warnFor(3 * MINUTE, 'critical')
        ])
      )

      await tickAll()

      expect(shown().map((warning) => [warning.episodeId, warning.reading.kernelLevel])).toEqual([
        [1, 'warn'],
        [2, 'critical']
      ])
    })

    it('does not reopen for a level the closed popup already reached', async () => {
      const { tickAll, shown } = setup(
        darwinSeries([
          ...warnFor(3 * MINUTE),
          ...warnFor(2 * MINUTE, 'critical'),
          ...normalFor(11 * MINUTE),
          ...warnFor(3 * MINUTE, 'critical')
        ])
      )

      await tickAll()

      expect(shown()).toHaveLength(1)
    })

    it('opens a new popup for a new situation after thirty minutes', async () => {
      const { tickAll, shown } = setup(
        darwinSeries([...warnFor(3 * MINUTE), ...normalFor(30 * MINUTE), ...warnFor(3 * MINUTE)])
      )

      await tickAll()

      expect(shown().map((warning) => warning.episodeId)).toEqual([1, 2])
    })

    it('treats a reading gap (sleep) as a break, not as a sustained signal', async () => {
      const series = darwinSeries(warnFor(MINUTE))
      const afterSleep = darwinSeries(warnFor(MINUTE), series.at(-1)!.readAt + 20 * MINUTE)
      const { tickAll, shown } = setup([...series, ...afterSleep])

      await tickAll()

      expect(shown()).toEqual([])
    })

    it('ignores fallback readings taken when sysctl failed', async () => {
      const fallback: MemoryPressureReading[] = Array.from({ length: 10 }, (_, index) => ({
        totalMemory: 16 * GIB,
        availableMemory: 0.2 * GIB,
        swapTotal: null,
        swapUsed: null,
        kernelLevel: null,
        source: 'fallback',
        readAt: index * TICK_MS
      }))
      const { tickAll, shown } = setup(fallback)

      await tickAll()

      expect(shown()).toEqual([])
    })
  })

  describe('dismiss', () => {
    it('keeps a dismissed popup quiet through more of the same', async () => {
      const { tickN, monitor, states, shown } = setup(darwinSeries(warnFor(15 * MINUTE)))
      await tickN(5)

      monitor.dismiss(1)
      const afterDismiss = states.length
      await tickN(20)

      expect(states[afterDismiss - 1]).toEqual({ warning: null })
      expect(states.length).toBe(afterDismiss)
      expect(monitor.getState()).toEqual({ warning: null })
      expect(shown()).toHaveLength(1)
    })

    it('brings a dismissed popup back when the kernel level rises to critical', async () => {
      const { tickN, monitor, shown, collectPanes } = setup(
        darwinSeries([...warnFor(4 * MINUTE), ...warnFor(4 * MINUTE, 'critical')])
      )
      await tickN(6)
      monitor.dismiss(1)

      await tickN(ticksFor(4 * MINUTE))

      expect(monitor.getState().warning).toMatchObject({ episodeId: 1 })
      expect(shown().map((warning) => warning.episodeId)).toEqual([1, 1])
      expect(collectPanes).toHaveBeenCalledTimes(2)
    })

    it('brings a dismissed Linux popup back when free memory falls five more points', async () => {
      const { tickN, monitor, shown } = setup(
        linuxSeries([...Array.from({ length: 6 }, () => 9), ...Array.from({ length: 4 }, () => 3)])
      )
      await tickN(6)
      monitor.dismiss(1)

      await tickN(4)

      expect(shown().map((warning) => warning.episodeId)).toEqual([1, 1])
      expect(monitor.getState().warning).not.toBeNull()
    })

    it('ignores a dismiss for an episode that is not the current one', async () => {
      const { tickN, monitor } = setup(darwinSeries(warnFor(3 * MINUTE)))
      await tickN(5)

      monitor.dismiss(7)

      expect(monitor.getState().warning?.episodeId).toBe(1)
    })
  })

  describe('settings and sampling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('reads nothing while turned off and clears a visible warning when turned off', async () => {
      const { monitor, tickN, states, readPressure, setSettings } = setup(
        darwinSeries(warnFor(5 * MINUTE))
      )
      await tickN(5)

      setSettings({ enabled: false, thresholdPercent: 10 })
      monitor.applySettings()
      await monitor.tick()

      expect(readPressure).toHaveBeenCalledTimes(5)
      expect(states.at(-1)).toEqual({ warning: null })
    })

    it('forgets the readings it held when turned off, so a re-enable needs a fresh window', async () => {
      const { monitor, tickN, shown, setSettings } = setup(darwinSeries(warnFor(5 * MINUTE)))
      await tickN(3)

      setSettings({ enabled: false, thresholdPercent: 10 })
      monitor.applySettings()
      monitor.stop()
      setSettings({ enabled: true, thresholdPercent: 10 })
      await tickN(3)

      expect(shown()).toEqual([])
    })

    it('applies a higher threshold to the Linux rule', async () => {
      const { tickN, shown, setSettings } = setup(linuxSeries(Array.from({ length: 12 }, () => 14)))
      await tickN(6)
      expect(shown()).toEqual([])

      setSettings({ enabled: true, thresholdPercent: 15 })
      await tickN(6)

      expect(shown()).toHaveLength(1)
    })

    it('never overlaps two readings', async () => {
      const { monitor, readPressure } = setup(darwinSeries(normalFor(MINUTE)))

      await Promise.all([monitor.tick(), monitor.tick()])

      expect(readPressure).toHaveBeenCalledTimes(1)
    })

    it('re-sweeps on demand only while a visible episode is open', async () => {
      const { monitor, tickN, collectPanes } = setup(darwinSeries(warnFor(3 * MINUTE)))

      await monitor.refresh()
      expect(collectPanes).not.toHaveBeenCalled()

      await tickN(5)
      await monitor.refresh()
      expect(collectPanes).toHaveBeenCalledTimes(2)
    })

    it('samples on its interval while on and stops when turned off', async () => {
      const { monitor, readPressure, setSettings } = setup(darwinSeries(normalFor(10 * MINUTE)))

      monitor.start()
      await vi.advanceTimersByTimeAsync(3 * TICK_MS)
      const whileOn = readPressure.mock.calls.length
      setSettings({ enabled: false, thresholdPercent: 10 })
      monitor.applySettings()
      await vi.advanceTimersByTimeAsync(5 * TICK_MS)

      expect(whileOn).toBe(4)
      expect(readPressure).toHaveBeenCalledTimes(whileOn)
      monitor.stop()
    })
  })
})
