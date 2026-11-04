import { describe, expect, it } from 'vitest'
import {
  createQuitTeardownDiagnosticsObserver,
  QUIT_TEARDOWN_PENDING_REPORT_MS
} from './quit-teardown-diagnostics'

describe('createQuitTeardownDiagnosticsObserver', () => {
  it('observes nothing without ORCA_STARTUP_DIAGNOSTICS', () => {
    expect(createQuitTeardownDiagnosticsObserver({})).toEqual({})
  })

  // Why: E2E force-kills a quit at 10 s; a later report would never reach the trace.
  it('reports pending members before the E2E graceful-close timeout', () => {
    const observer = createQuitTeardownDiagnosticsObserver({ ORCA_STARTUP_DIAGNOSTICS: '1' })
    expect(observer.memberSettled).toBeTypeOf('function')
    expect(observer.stillPending).toBeTypeOf('function')
    expect(observer.pendingReportMs).toBe(QUIT_TEARDOWN_PENDING_REPORT_MS)
    expect(QUIT_TEARDOWN_PENDING_REPORT_MS).toBeLessThan(10_000)
  })
})
