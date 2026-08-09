import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrashReportRecord } from '../../shared/crash-reporting'

const {
  handlers,
  listeners,
  clipboardWriteTextMock,
  recordCrashBreadcrumbMock,
  spanEndMock,
  startSpanMock
} = vi.hoisted(() => {
  const spanEndMock = vi.fn()
  return {
    handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
    listeners: new Map<string, (_event: unknown, args?: unknown) => void>(),
    clipboardWriteTextMock: vi.fn(),
    recordCrashBreadcrumbMock: vi.fn(),
    spanEndMock,
    startSpanMock: vi.fn(() => ({
      traceId: 'trace-id',
      spanId: 'span-id',
      setAttribute: vi.fn(),
      addEvent: vi.fn(),
      fail: vi.fn(),
      interrupt: vi.fn(),
      end: spanEndMock
    }))
  }
})

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3-test' },
  clipboard: { writeText: clipboardWriteTextMock },
  ipcMain: {
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeAllListeners: vi.fn((channel: string) => listeners.delete(channel)),
    on: vi.fn((channel: string, listener: (_event: unknown, args?: unknown) => void) => {
      listeners.set(channel, listener)
    })
  }
}))

vi.mock('../crash-reporting/crash-breadcrumb-store', () => ({
  getCrashBreadcrumbSnapshot: vi.fn(() => []),
  // Renderer breadcrumb routing is covered in crash-reporting-renderer-breadcrumbs.test.ts.
  recordCoalescedCrashBreadcrumb: vi.fn(),
  recordCrashBreadcrumb: (...args: unknown[]) => recordCrashBreadcrumbMock(...args)
}))

vi.mock('../observability/tracer', () => ({
  startSpan: startSpanMock
}))

import {
  _getCrashReportingStateSizesForTests,
  _resetRendererErrorReportDedupeForTests,
  registerCrashReportingHandlers
} from './crash-reporting'

const FORK_NEW_ISSUE = 'https://github.com/ab2webco/orca-oss/issues/new'

function copiedText(): string {
  return String(clipboardWriteTextMock.mock.calls[0]?.[0])
}

function titleOf(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get('title') ?? '')
}

function crashStore(overrides: Record<string, unknown> = {}): never {
  return {
    getById: vi.fn(async () => null),
    dismiss: vi.fn(),
    markSent: vi.fn(),
    markDismissedSent: vi.fn(),
    listRecent: vi.fn(async () => []),
    record: vi.fn(),
    formatDiagnosticText: vi.fn(),
    ...overrides
  } as never
}

function report(
  status: CrashReportRecord['status'] = 'pending',
  id = 'crash-1'
): CrashReportRecord {
  return {
    id,
    createdAt: '2026-05-16T01:00:00.000Z',
    status,
    source: 'renderer',
    processType: 'renderer',
    reason: 'crashed',
    exitCode: 5,
    appVersion: '1.0.0',
    platform: process.platform,
    osRelease: 'test',
    arch: process.arch,
    electronVersion: '41',
    chromeVersion: '141',
    details: {}
  }
}

describe('registerCrashReportingHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    listeners.clear()
    clipboardWriteTextMock.mockReset()
    startSpanMock.mockClear()
    spanEndMock.mockClear()
    recordCrashBreadcrumbMock.mockReset()
    _resetRendererErrorReportDedupeForTests()
  })

  it('copies the latest pending diagnostic text to the clipboard', async () => {
    const latest = report()
    registerCrashReportingHandlers({
      getById: vi.fn(async () => latest),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => [latest]),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    } as never)

    const result = await handlers.get('crashReports:copyLatestDiagnostics')?.(null, {
      notes: 'extra /Users/alice/project'
    })

    expect(result).toEqual({ ok: true })
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(expect.stringContaining('[Crash Report]'))
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      expect.stringContaining('extra [redacted-path]')
    )
  })

  it('copies an uncaptured crash report when the caller intentionally omits reportId', async () => {
    const pending = report('pending', 'crash-late-pending')
    const listRecent = vi.fn(async () => [pending])
    registerCrashReportingHandlers({
      getById: vi.fn(async () => null),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent,
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    } as never)

    const result = await handlers.get('crashReports:copyLatestDiagnostics')?.(null, {
      notes: 'after opening /Users/alice/project'
    })

    expect(result).toEqual({ ok: true })
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(expect.stringContaining('not captured'))
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(expect.stringContaining('[redacted-path]'))
    expect(clipboardWriteTextMock).not.toHaveBeenCalledWith(
      expect.stringContaining('crash-late-pending')
    )
    expect(listRecent).not.toHaveBeenCalled()
  })

  it('returns dismissed unsent reports for the manual Help menu entry', async () => {
    const dismissed = report('dismissed', 'crash-help-menu')
    registerCrashReportingHandlers(
      crashStore({
        getById: vi.fn(async () => dismissed),
        listRecent: vi.fn(async () => [report('sent', 'crash-sent'), dismissed])
      })
    )

    await expect(handlers.get('crashReports:getLatestPending')?.(null)).resolves.toBeNull()
    await expect(handlers.get('crashReports:getLatestReport')?.(null)).resolves.toEqual(dismissed)
  })

  it('hands a pending report to the fork issue form and marks it sent', async () => {
    const pending = report('pending', 'crash-pending')
    const sent = report('sent', pending.id)
    const markSent = vi.fn(async () => sent)
    registerCrashReportingHandlers(crashStore({ getById: vi.fn(async () => pending), markSent }))

    const result = (await handlers.get('crashReports:reportOnGitHub')?.(null, {
      reportId: pending.id,
      notes: 'extra /Users/alice/project'
    })) as { ok: boolean; report: CrashReportRecord | null; url: string; bodyInUrl: boolean }

    expect(result.ok).toBe(true)
    expect(result.report).toEqual(sent)
    expect(markSent).toHaveBeenCalledWith(pending.id)
    expect(result.url.startsWith(`${FORK_NEW_ISSUE}?`)).toBe(true)
    expect(result.url).not.toContain('onorca.dev')
    expect(titleOf(result.url)).toBe('Crash: renderer crashed')
    expect(copiedText()).toContain('[Crash Report]')
    // Why: the notes reach a public issue, so redaction has to survive the move.
    expect(copiedText()).toContain('extra [redacted-path]')
    expect(copiedText()).not.toContain('alice')
  })

  it('prefills the issue body when the report is short enough to fit a URL', async () => {
    const pending = report('pending', 'crash-short')
    registerCrashReportingHandlers(crashStore({ getById: vi.fn(async () => pending) }))

    const result = (await handlers.get('crashReports:reportOnGitHub')?.(null, {
      reportId: pending.id
    })) as { url: string; bodyInUrl: boolean }

    expect(result.bodyInUrl).toBe(true)
    expect(decodeURIComponent(new URL(result.url).searchParams.get('body') ?? '')).toBe(
      copiedText()
    )
  })

  it('leaves an oversized report to the clipboard instead of the URL', async () => {
    const pending = { ...report('pending', 'crash-long'), details: { note: 'x'.repeat(9000) } }
    registerCrashReportingHandlers(crashStore({ getById: vi.fn(async () => pending) }))

    const result = (await handlers.get('crashReports:reportOnGitHub')?.(null, {
      reportId: pending.id
    })) as { url: string; bodyInUrl: boolean }

    expect(result.bodyInUrl).toBe(false)
    expect(new URL(result.url).searchParams.get('body')).toBeNull()
    expect(copiedText()).toContain('x'.repeat(9000))
  })

  it('reports an uncaptured Help menu crash without touching the store', async () => {
    const pending = report('pending', 'crash-late-pending')
    const markSent = vi.fn()
    const listRecent = vi.fn(async () => [pending])
    registerCrashReportingHandlers(crashStore({ markSent, listRecent }))

    const result = (await handlers.get('crashReports:reportOnGitHub')?.(null, {
      notes: 'blank window after opening /Users/alice/project'
    })) as { ok: boolean; report: CrashReportRecord | null; url: string }

    expect(result.ok).toBe(true)
    expect(result.report).toBeNull()
    expect(titleOf(result.url)).toBe('Crash report')
    expect(copiedText()).toContain('Report ID: not captured')
    expect(copiedText()).toContain('[redacted-path]')
    expect(markSent).not.toHaveBeenCalled()
    expect(listRecent).not.toHaveBeenCalled()
  })

  it('marks a dismissed startup prompt sent once it is handed to GitHub', async () => {
    const dismissed = report('dismissed', 'crash-dismissed')
    const sent = report('sent', dismissed.id)
    const markDismissedSent = vi.fn(async () => sent)
    registerCrashReportingHandlers(
      crashStore({ getById: vi.fn(async () => dismissed), markDismissedSent })
    )

    const result = (await handlers.get('crashReports:reportOnGitHub')?.(null, {
      reportId: dismissed.id,
      notes: 'reported from startup prompt'
    })) as { ok: boolean; report: CrashReportRecord | null }

    expect(result.ok).toBe(true)
    expect(result.report).toEqual(sent)
    expect(markDismissedSent).toHaveBeenCalledWith(dismissed.id)
    expect(copiedText()).toContain('reported from startup prompt')
  })

  it('still opens the issue when the store cannot record the report as sent', async () => {
    const pending = report('pending', 'crash-store-broken')
    registerCrashReportingHandlers(
      crashStore({
        getById: vi.fn(async () => pending),
        markSent: vi.fn(async () => {
          throw new Error('store write failed')
        })
      })
    )

    const result = (await handlers.get('crashReports:reportOnGitHub')?.(null, {
      reportId: pending.id
    })) as { ok: boolean; report: CrashReportRecord | null; url: string }

    expect(result.ok).toBe(true)
    expect(result.report?.status).toBe('sent')
    expect(result.url.startsWith(`${FORK_NEW_ISSUE}?`)).toBe(true)
  })

  it('titles a React boundary crash by the surface that failed', async () => {
    const boundary: CrashReportRecord = {
      ...report('pending', 'crash-boundary'),
      processType: 'react-render',
      reason: 'react-error-boundary',
      details: { surface: 'sidebar', boundary_id: 'sidebar-root' }
    }
    registerCrashReportingHandlers(crashStore({ getById: vi.fn(async () => boundary) }))

    const result = (await handlers.get('crashReports:reportOnGitHub')?.(null, {
      reportId: boundary.id
    })) as { url: string }

    expect(titleOf(result.url)).toBe('Crash: React render error in sidebar')
  })

  it('dismisses a pending report locally without copying or opening anything', async () => {
    const latest = report('pending', 'crash-dismiss')
    const dismissed = report('dismissed', latest.id)
    const dismiss = vi.fn(async () => dismissed)
    registerCrashReportingHandlers(
      crashStore({
        getById: vi.fn(async () => latest),
        dismiss,
        listRecent: vi.fn(async () => [latest])
      })
    )

    const result = await handlers.get('crashReports:dismiss')?.(null, { reportId: latest.id })

    expect(result).toEqual(dismissed)
    expect(dismiss).toHaveBeenCalledWith(latest.id)
    expect(clipboardWriteTextMock).not.toHaveBeenCalled()
  })

  it('bounds reported ids by evicting the oldest handoffs', async () => {
    registerCrashReportingHandlers(
      crashStore({
        getById: vi.fn(async (reportId: string) => report('pending', reportId)),
        markSent: vi.fn(async (reportId: string) => report('sent', reportId))
      })
    )

    for (let i = 0; i < 260; i += 1) {
      await handlers.get('crashReports:reportOnGitHub')?.(null, { reportId: `crash-${i}` })
    }

    expect(_getCrashReportingStateSizesForTests().submittedReportIds).toBe(256)
  })

  it('records a deduped renderer error boundary report through the crash store', async () => {
    const recorded = report('pending', 'react-render')
    const recordMock = vi.fn(async () => recorded)
    registerCrashReportingHandlers({
      getById: vi.fn(),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => []),
      record: recordMock,
      formatDiagnosticText: vi.fn()
    } as never)

    const args = {
      boundaryId: 'terminal.workbench',
      surface: 'terminal-workbench',
      errorName: 'TypeError',
      errorMessage: 'Cannot read /Users/alice/project/token=abc123',
      errorStack: 'TypeError: nope\n    at /Users/alice/project/App.tsx:12:1',
      componentStack: 'at Terminal\nat App',
      activeView: 'terminal',
      activeModal: 'none',
      activeTabType: 'terminal',
      activeRightSidebarTab: 'source-control',
      hasActiveWorktree: true
    }

    await expect(handlers.get('crashReports:recordRendererError')?.(null, args)).resolves.toEqual({
      ok: true,
      report: recorded,
      deduped: false
    })
    await expect(handlers.get('crashReports:recordRendererError')?.(null, args)).resolves.toEqual({
      ok: true,
      report: null,
      deduped: true
    })

    expect(recordMock).toHaveBeenCalledTimes(1)
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'renderer',
        processType: 'react-render',
        reason: 'react-error-boundary',
        exitCode: null,
        appVersion: '1.2.3-test',
        details: expect.objectContaining({
          boundary_id: 'terminal.workbench',
          surface: 'terminal-workbench',
          error_name: 'TypeError',
          error_message: 'Cannot read /Users/alice/project/token=abc123',
          active_view: 'terminal',
          active_modal: 'none',
          active_tab_type: 'terminal',
          right_sidebar_tab: 'source-control',
          has_active_worktree: true
        })
      })
    )
  })

  it('rejects invalid renderer error boundary surfaces', async () => {
    const recordMock = vi.fn()
    registerCrashReportingHandlers({
      getById: vi.fn(),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => []),
      record: recordMock,
      formatDiagnosticText: vi.fn()
    } as never)

    await expect(
      handlers.get('crashReports:recordRendererError')?.(null, {
        boundaryId: 'terminal.workbench',
        surface: 'unknown',
        errorName: 'TypeError',
        errorMessage: 'nope'
      })
    ).resolves.toEqual({ ok: false, error: 'Invalid renderer error report.' })
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('bounds renderer error dedupe keys by evicting the oldest unique reports', async () => {
    let recordCount = 0
    const recordMock = vi.fn(async () => report('pending', `react-render-${recordCount++}`))
    registerCrashReportingHandlers({
      getById: vi.fn(),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => []),
      record: recordMock,
      formatDiagnosticText: vi.fn()
    } as never)

    const baseArgs = {
      boundaryId: 'terminal.workbench',
      surface: 'terminal-workbench',
      errorName: 'TypeError',
      componentStack: 'at Terminal'
    }

    for (let i = 0; i < 260; i += 1) {
      await handlers.get('crashReports:recordRendererError')?.(null, {
        ...baseArgs,
        errorMessage: `unique-render-error-${i}`
      })
    }

    await expect(
      handlers.get('crashReports:recordRendererError')?.(null, {
        ...baseArgs,
        errorMessage: 'unique-render-error-0'
      })
    ).resolves.toEqual({
      ok: true,
      report: expect.objectContaining({ id: 'react-render-260' }),
      deduped: false
    })
    await expect(
      handlers.get('crashReports:recordRendererError')?.(null, {
        ...baseArgs,
        errorMessage: 'unique-render-error-259'
      })
    ).resolves.toEqual({
      ok: true,
      report: null,
      deduped: true
    })

    expect(recordMock).toHaveBeenCalledTimes(261)
  })
})
