import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeHangDetectionMarker } from './hang-detection-marker'
import type * as MarkerModule from './hang-detection-marker'
import type * as ReportModule from './main-thread-hang-report'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({ unref: vi.fn() }))
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

// Why: snapshot the record each time the marker is written, to check what a marker reader finds.
const { recordAtMarkerWrite } = vi.hoisted(() => ({ recordAtMarkerWrite: [] as string[] }))
vi.mock('./hang-detection-marker', async (importOriginal) => {
  const original = await importOriginal<typeof MarkerModule>()
  return {
    ...original,
    writeHangDetectionMarker: (
      path: string,
      marker: Parameters<typeof original.writeHangDetectionMarker>[1]
    ) => {
      if (marker.reportPath) {
        recordAtMarkerWrite.push(readFileSync(marker.reportPath, { encoding: 'utf8', flag: 'a+' }))
      }
      original.writeHangDetectionMarker(path, marker)
    }
  }
})
vi.mock('./main-thread-hang-report', async (importOriginal) => ({
  ...(await importOriginal<typeof ReportModule>()),
  writeMainThreadHangReport: (options: { reportPath: string }) => {
    writeFileSync(options.reportPath, 'stalled\n')
  }
}))

import {
  isHangWatchdogWorkerData,
  recordHangObservation,
  runWatchdog
} from './main-thread-hang-watchdog-entry'

describe('recordHangObservation', () => {
  let dir: string
  let killSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hang-detect-'))
    spawnMock.mockClear()
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    killSpy.mockRestore()
    exitSpy.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('records an unresolved hang', () => {
    const markerPath = join(dir, 'marker.json')
    recordHangObservation({
      parentPid: 4242,
      markerPath,
      unresponsiveMs: 47_000,
      selfRecovered: false
    })
    expect(consumeHangDetectionMarker(markerPath)).toMatchObject({
      parentPid: 4242,
      unresponsiveMs: 47_000,
      selfRecovered: false
    })
  })

  it('overwrites the marker when the stall clears, keeping one observation per stall', () => {
    const markerPath = join(dir, 'marker.json')
    recordHangObservation({
      parentPid: 4242,
      markerPath,
      unresponsiveMs: 47_000,
      selfRecovered: false
    })
    recordHangObservation({
      parentPid: 4242,
      markerPath,
      unresponsiveMs: 62_000,
      selfRecovered: true
    })
    expect(consumeHangDetectionMarker(markerPath)).toMatchObject({
      unresponsiveMs: 62_000,
      selfRecovered: true
    })
  })

  it('never spawns, signals, or exits', () => {
    // Why: a false positive must never kill a live main thread while writes may be in flight.
    recordHangObservation({
      parentPid: 4242,
      markerPath: join(dir, 'marker.json'),
      unresponsiveMs: 45_000,
      selfRecovered: false
    })
    expect(spawnMock).not.toHaveBeenCalled()
    expect(killSpy).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('survives an unwritable marker path', () => {
    expect(() =>
      recordHangObservation({
        parentPid: 4242,
        markerPath: join(dir, 'missing-subdir', 'marker.json'),
        unresponsiveMs: 45_000,
        selfRecovered: false
      })
    ).not.toThrow()
  })

  it('is a no-op when no marker path is configured', () => {
    expect(() =>
      recordHangObservation({
        parentPid: 4242,
        markerPath: '',
        unresponsiveMs: 45_000,
        selfRecovered: false
      })
    ).not.toThrow()
  })
})

describe('watchdog worker entry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts only complete positive worker data', () => {
    expect(
      isHangWatchdogWorkerData({
        parentPid: 42,
        markerPath: '/tmp/marker',
        userDataPath: '',
        timeoutMs: 100,
        checkIntervalMs: 25
      })
    ).toBe(true)
    for (const value of [
      null,
      {},
      {
        parentPid: 0,
        markerPath: '/tmp/marker',
        userDataPath: '',
        timeoutMs: 100,
        checkIntervalMs: 25
      },
      { parentPid: 42, markerPath: 7, userDataPath: '', timeoutMs: 100, checkIntervalMs: 25 },
      { parentPid: 42, markerPath: '/tmp/marker', timeoutMs: 100, checkIntervalMs: 25 },
      {
        parentPid: 42,
        markerPath: '/tmp/marker',
        userDataPath: '',
        timeoutMs: 0,
        checkIntervalMs: 25
      },
      {
        parentPid: 42,
        markerPath: '/tmp/marker',
        userDataPath: '',
        timeoutMs: 100,
        checkIntervalMs: Infinity
      }
    ]) {
      expect(isHangWatchdogWorkerData(value)).toBe(false)
    }
  })

  it('routes heartbeats and shuts down its timer and port', () => {
    const markerPath = join(tmpdir(), `hang-watchdog-entry-${process.pid}.json`)
    let onMessage: ((message: { type: 'heartbeat' | 'shutdown' }) => void) | undefined
    const port = {
      on: vi.fn(
        (_event: 'message', listener: (message: { type: 'heartbeat' | 'shutdown' }) => void) => {
          onMessage = listener
        }
      ),
      close: vi.fn()
    }
    try {
      runWatchdog(
        {
          parentPid: process.pid,
          markerPath,
          userDataPath: '',
          timeoutMs: 100,
          checkIntervalMs: 25
        },
        port
      )
      vi.advanceTimersByTime(75)
      onMessage?.({ type: 'heartbeat' })
      vi.advanceTimersByTime(75)
      expect(consumeHangDetectionMarker(markerPath)).toBeNull()
      vi.advanceTimersByTime(50)
      expect(consumeHangDetectionMarker(markerPath)).toMatchObject({ selfRecovered: false })

      onMessage?.({ type: 'heartbeat' })
      expect(consumeHangDetectionMarker(markerPath)).toMatchObject({ selfRecovered: true })
      onMessage?.({ type: 'shutdown' })
      expect(port.close).toHaveBeenCalledOnce()
      vi.advanceTimersByTime(1_000)
      expect(port.close).toHaveBeenCalledOnce()
      expect(consumeHangDetectionMarker(markerPath)).toBeNull()
    } finally {
      rmSync(markerPath, { force: true })
    }
  })

  it('closes the record before the marker says the stall cleared', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'hang-watchdog-order-'))
    mkdirSync(join(userDataPath, 'logs'))
    let onMessage: ((message: { type: 'heartbeat' | 'shutdown' }) => void) | undefined
    const port = {
      on: vi.fn(
        (_event: 'message', listener: (message: { type: 'heartbeat' | 'shutdown' }) => void) => {
          onMessage = listener
        }
      ),
      close: vi.fn()
    }
    recordAtMarkerWrite.length = 0
    try {
      runWatchdog(
        {
          parentPid: process.pid,
          markerPath: join(userDataPath, 'marker.json'),
          userDataPath,
          timeoutMs: 100,
          checkIntervalMs: 25
        },
        port
      )
      vi.advanceTimersByTime(150)
      onMessage?.({ type: 'heartbeat' })
      onMessage?.({ type: 'shutdown' })
      expect(recordAtMarkerWrite).toHaveLength(2)
      expect(recordAtMarkerWrite[1]).toContain('Main thread answered again after')
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
