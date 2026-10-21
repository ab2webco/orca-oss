import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetTracerForTests, setActiveSink, type TracerSink } from '../../observability/tracer'
import { startOrchestrationAtLaunch } from './orchestration-startup'

describe('startOrchestrationAtLaunch (ORCA-726)', () => {
  afterEach(() => {
    _resetTracerForTests()
    vi.restoreAllMocks()
  })

  it('records an orchestration DB failure instead of throwing out of app startup', () => {
    const pushed: unknown[] = []
    const sink: TracerSink = {
      push: (record) => pushed.push(record),
      flush: () => {},
      close: () => {}
    }
    setActiveSink(sink)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ensureMonitor = vi.fn()

    expect(() =>
      startOrchestrationAtLaunch({
        prepareLegacyWorkerTerminalRecovery: () => {
          throw new Error('Legacy orchestration adoption produced inconsistent Run ownership.')
        },
        ensureOrchestrationDispatchDeadlineMonitor: ensureMonitor
      })
    ).not.toThrow()

    expect(pushed).toEqual([
      expect.objectContaining({
        name: 'orchestration.startup',
        exit: expect.objectContaining({
          _tag: 'Failure',
          cause: expect.stringContaining('inconsistent Run ownership')
        })
      })
    ])
  })

  it('arms the deadline monitor after recovery when the DB opens', () => {
    const calls: string[] = []

    startOrchestrationAtLaunch({
      prepareLegacyWorkerTerminalRecovery: () => {
        calls.push('recovery')
      },
      ensureOrchestrationDispatchDeadlineMonitor: () => {
        calls.push('monitor')
      }
    })

    expect(calls).toEqual(['recovery', 'monitor'])
  })
})
