// @vitest-environment happy-dom

import React, { type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrashReportRecord } from '../../../../shared/crash-reporting'

const mocks = vi.hoisted(() => ({
  reportOnGitHub: vi.fn(),
  openUrl: vi.fn(),
  copyLatestDiagnostics: vi.fn(),
  dismiss: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: {
    dismiss: vi.fn(),
    error: mocks.toastError,
    success: mocks.toastSuccess,
    warning: vi.fn()
  }
}))

vi.mock('@/components/ui/dialog', async () => {
  const ReactModule = await import('react')
  const Section = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    Dialog: ({ children }: { children?: ReactNode }) => <>{children}</>,
    DialogContent: ReactModule.forwardRef<
      HTMLDivElement,
      React.HTMLAttributes<HTMLDivElement> & { children?: ReactNode }
    >(function DialogContent({ children, ...props }, ref) {
      return (
        <div ref={ref} {...props}>
          {children}
        </div>
      )
    }),
    DialogDescription: Section,
    DialogFooter: Section,
    DialogHeader: Section,
    DialogTitle: Section
  }
})

import { CrashReportDialogSurface } from './CrashReportDialogSurface'

const ISSUE_URL =
  'https://github.com/ab2webco/orca-oss/issues/new?title=Crash%3A%20renderer%20crashed'

function report(status: CrashReportRecord['status'] = 'pending'): CrashReportRecord {
  return {
    id: 'crash-1',
    createdAt: '2026-05-16T01:00:00.000Z',
    status,
    source: 'renderer',
    processType: 'renderer',
    reason: 'crashed',
    exitCode: 5,
    appVersion: '1.4.160-lab.30',
    platform: 'darwin',
    osRelease: '25.6.0',
    arch: 'arm64',
    electronVersion: '41',
    chromeVersion: '141',
    details: {}
  }
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.reportOnGitHub.mockResolvedValue({
    ok: true,
    report: report('sent'),
    url: ISSUE_URL,
    bodyInUrl: false
  })
  mocks.copyLatestDiagnostics.mockResolvedValue({ ok: true })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      crashReports: {
        reportOnGitHub: mocks.reportOnGitHub,
        copyLatestDiagnostics: mocks.copyLatestDiagnostics,
        dismiss: mocks.dismiss
      },
      shell: { openUrl: mocks.openUrl }
    }
  })
})

afterEach(() => {
  cleanup()
})

function renderSurface(onReportChange = vi.fn()): { onReportChange: ReturnType<typeof vi.fn> } {
  render(
    <CrashReportDialogSurface
      open
      report={report()}
      loading={false}
      onOpenChange={vi.fn()}
      onReportChange={onReportChange}
    />
  )
  return { onReportChange }
}

describe('CrashReportDialogSurface', () => {
  it('hands the crash to the fork issue form instead of uploading it', async () => {
    const { onReportChange } = renderSurface()
    fireEvent.change(
      screen.getByPlaceholderText('Optional: what were you doing before Orca closed?'),
      {
        target: { value: 'died on resume' }
      }
    )

    fireEvent.click(screen.getByRole('button', { name: /Report on GitHub/ }))

    await waitFor(() => expect(mocks.openUrl).toHaveBeenCalledWith(ISSUE_URL))
    expect(mocks.reportOnGitHub).toHaveBeenCalledWith({
      reportId: 'crash-1',
      notes: 'died on resume'
    })
    expect(onReportChange).toHaveBeenCalledWith(report('sent'))
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'Crash details copied. Paste them into the GitHub issue before submitting.'
    )
  })

  it('never opens a URL when the report could not be prepared', async () => {
    mocks.reportOnGitHub.mockResolvedValue({
      ok: false,
      report: report(),
      error: 'Crash diagnostics are too large to copy safely.'
    })
    renderSurface()

    fireEvent.click(screen.getByRole('button', { name: /Report on GitHub/ }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    expect(mocks.openUrl).not.toHaveBeenCalled()
  })

  it('keeps Copy Details working on its own', async () => {
    renderSurface()

    fireEvent.click(screen.getByRole('button', { name: /Copy Details/ }))

    await waitFor(() =>
      expect(mocks.copyLatestDiagnostics).toHaveBeenCalledWith({ reportId: 'crash-1', notes: '' })
    )
    expect(mocks.reportOnGitHub).not.toHaveBeenCalled()
  })
})
