import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MemoryPressurePane,
  MemoryPressureReading,
  MemoryPressureState
} from '../../shared/memory-pressure-types'
import type { MemoryPressureWarningSettings } from '../../shared/memory-pressure-settings'
import { MemoryPressureMonitor } from './memory-pressure-monitor'

const GIB = 1024 ** 3

function reading(availablePercent: number, readAt = 0): MemoryPressureReading {
  return {
    totalMemory: 16 * GIB,
    availableMemory: (16 * GIB * availablePercent) / 100,
    swapTotal: null,
    swapUsed: null,
    kernelLevel: null,
    readAt
  }
}

const PANE: MemoryPressurePane = {
  sessionId: 'pty-1',
  paneKey: 'tab-1:leaf-1',
  worktreeId: 'repo::/w',
  worktreeName: 'w',
  repoName: 'repo',
  memory: 2 * GIB,
  metric: 'phys-footprint',
  lastOutputAt: null
}

function setup(initial: number[]) {
  const readings = [...initial]
  let settings: MemoryPressureWarningSettings = { enabled: true, thresholdPercent: 10 }
  const states: MemoryPressureState[] = []
  const readPressure = vi.fn(async () => reading(readings.shift() ?? 50))
  const collectPanes = vi.fn(async () => [PANE])
  const monitor = new MemoryPressureMonitor({
    readPressure,
    collectPanes,
    getSettings: () => settings,
    broadcast: (state) => states.push(state),
    intervalMs: 1_000
  })
  return {
    monitor,
    readings,
    states,
    readPressure,
    collectPanes,
    setSettings: (next: MemoryPressureWarningSettings) => {
      settings = next
    }
  }
}

describe('MemoryPressureMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays silent and sweeps nothing while memory is fine', async () => {
    const { monitor, states, collectPanes } = setup([50, 40])

    await monitor.tick()
    await monitor.tick()

    expect(states).toEqual([])
    expect(collectPanes).not.toHaveBeenCalled()
    expect(monitor.getState()).toEqual({ warning: null })
  })

  it('opens an episode, then fills in the heaviest panes from one sweep', async () => {
    const { monitor, states, collectPanes } = setup([5, 6])

    await monitor.tick()
    await monitor.tick()

    expect(collectPanes).toHaveBeenCalledTimes(1)
    expect(states[0].warning).toMatchObject({ episodeId: 1, sweeping: true, panes: [] })
    expect(states[1].warning).toMatchObject({ episodeId: 1, sweeping: false, panes: [PANE] })
    expect(monitor.getState().warning).toMatchObject({ episodeId: 1, panes: [PANE] })
  })

  it('does not bring a dismissed episode back while pressure lasts', async () => {
    const { monitor, states } = setup([5, 4, 3])
    await monitor.tick()

    monitor.dismiss(1)
    const afterDismiss = states.length
    await monitor.tick()
    await monitor.tick()

    expect(states[afterDismiss - 1]).toEqual({ warning: null })
    expect(states.length).toBe(afterDismiss)
    expect(monitor.getState()).toEqual({ warning: null })
  })

  it('starts a new episode after pressure clears and returns', async () => {
    const { monitor, states, collectPanes } = setup([5, 50, 5])
    await monitor.tick()
    monitor.dismiss(1)

    await monitor.tick()
    await monitor.tick()

    expect(collectPanes).toHaveBeenCalledTimes(2)
    expect(states.at(-1)?.warning).toMatchObject({ episodeId: 2, panes: [PANE] })
  })

  it('ignores a dismiss for an episode that is not the current one', async () => {
    const { monitor } = setup([5])
    await monitor.tick()

    monitor.dismiss(7)

    expect(monitor.getState().warning?.episodeId).toBe(1)
  })

  it('reads nothing while turned off and clears a visible warning when turned off', async () => {
    const { monitor, states, readPressure, setSettings } = setup([5])
    await monitor.tick()

    setSettings({ enabled: false, thresholdPercent: 10 })
    monitor.applySettings()
    await monitor.tick()

    expect(readPressure).toHaveBeenCalledTimes(1)
    expect(states.at(-1)).toEqual({ warning: null })
  })

  it('applies a higher threshold on the next reading', async () => {
    const { monitor, states, setSettings } = setup([14, 14])
    await monitor.tick()
    expect(states).toEqual([])

    setSettings({ enabled: true, thresholdPercent: 15 })
    await monitor.tick()

    expect(states.at(-1)?.warning?.episodeId).toBe(1)
  })

  it('never overlaps two readings', async () => {
    const { monitor, readPressure } = setup([50])

    await Promise.all([monitor.tick(), monitor.tick()])

    expect(readPressure).toHaveBeenCalledTimes(1)
  })

  it('re-sweeps on demand only while a visible episode is open', async () => {
    const { monitor, collectPanes } = setup([5])

    await monitor.refresh()
    expect(collectPanes).not.toHaveBeenCalled()

    await monitor.tick()
    await monitor.refresh()
    expect(collectPanes).toHaveBeenCalledTimes(2)
  })

  it('samples on its interval while on and stops when turned off', async () => {
    const { monitor, readPressure, setSettings } = setup([])

    monitor.start()
    await vi.advanceTimersByTimeAsync(3_000)
    const whileOn = readPressure.mock.calls.length
    setSettings({ enabled: false, thresholdPercent: 10 })
    monitor.applySettings()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(whileOn).toBe(4)
    expect(readPressure).toHaveBeenCalledTimes(whileOn)
    monitor.stop()
  })
})
