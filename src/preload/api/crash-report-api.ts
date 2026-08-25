import type {
  CrashReportBreadcrumbData,
  CrashReportCopyDiagnosticsArgs,
  CrashReportGitHubReportArgs,
  CrashReportGitHubReportResult,
  CrashReportRecord,
  ReactErrorBoundaryReportArgs,
  ReactErrorBoundaryReportResult
} from '../../shared/crash-reporting'
import type { RendererHeapStatistics } from '../../shared/renderer-heap-statistics'

export type CrashReportsApi = {
  /** Copies the report and returns the fork's prefilled issue URL to open. */
  reportOnGitHub: (args: CrashReportGitHubReportArgs) => Promise<CrashReportGitHubReportResult>
  getLatestPending: () => Promise<CrashReportRecord | null>
  getLatestReport: () => Promise<CrashReportRecord | null>
  dismiss: (args: { reportId: string }) => Promise<CrashReportRecord | null>
  recordRendererError: (
    args: ReactErrorBoundaryReportArgs
  ) => Promise<ReactErrorBoundaryReportResult>
  recordBreadcrumb: (args: { name: string; data?: CrashReportBreadcrumbData }) => void
  copyLatestDiagnostics: (
    args?: CrashReportCopyDiagnosticsArgs
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  /** Exact V8/Blink heap sizes; null when the runtime withholds them. */
  readHeapStatistics: () => RendererHeapStatistics | null
}

export type FeedbackApi = {
  /** Builds the fork's prefilled new-issue URL; the renderer opens it. */
  composeIssue: (args: {
    feedback: string
  }) => Promise<{ url: string; body: string; bodyInUrl: boolean }>
}
