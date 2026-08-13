import { useDeferredValue, useMemo, useState } from 'react'
import { AlertTriangle, Clipboard, Github } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useMountedRef } from '@/hooks/useMountedRef'
import {
  formatCrashReportText,
  isReactErrorBoundaryReport,
  type CrashReportRecord
} from '../../../../shared/crash-reporting'
import { translate } from '@/i18n/i18n'
import { useCrashReportCopy } from './use-crash-report-copy'

export const CRASH_REPORT_GITHUB_FAILURE_TOAST_ID = 'crash-report-github-failure'

function formatSummary(report: CrashReportRecord): string {
  if (isReactErrorBoundaryReport(report)) {
    const surface = typeof report.details.surface === 'string' ? report.details.surface : null
    return surface ? `React render error in ${surface}` : 'React render error'
  }
  return `${report.processType} ${report.reason}${
    report.exitCode === null ? '' : ` (exit ${report.exitCode})`
  }`
}

function getDialogTitle(report: CrashReportRecord | null): string {
  if (!report) {
    return 'Report a crash'
  }
  return report && isReactErrorBoundaryReport(report)
    ? 'Orca hit a recoverable UI error'
    : 'Orca closed unexpectedly'
}

function getDialogDescription(report: CrashReportRecord | null): string {
  if (!report) {
    return 'Report a crash as a public GitHub issue. The redacted details below are copied to your clipboard so you choose what to publish.'
  }
  return report && isReactErrorBoundaryReport(report)
    ? 'Report this UI failure as a public GitHub issue. The redacted details below are copied to your clipboard so you choose what to publish.'
    : 'Report this crash as a public GitHub issue. The redacted details below are copied to your clipboard so you choose what to publish.'
}

function getNotesPlaceholder(report: CrashReportRecord | null): string {
  if (!report) {
    return 'Optional: what happened?'
  }
  return report && isReactErrorBoundaryReport(report)
    ? 'Optional: what were you doing before this UI error?'
    : 'Optional: what were you doing before Orca closed?'
}

type CrashReportDialogSurfaceProps = {
  open: boolean
  report: CrashReportRecord | null
  loading: boolean
  onOpenChange: (open: boolean) => void
  onReportChange: (report: CrashReportRecord | null) => void
}

export function CrashReportDialogSurface({
  open,
  report,
  loading,
  onOpenChange,
  onReportChange
}: CrashReportDialogSurfaceProps): React.JSX.Element {
  const mountedRef = useMountedRef()
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const deferredNotes = useDeferredValue(notes)
  const diagnosticText = useMemo(
    // Why: formatting applies redaction and truncation over the full crash
    // payload. Keep that preview update out of the textarea keystroke path.
    () => (report ? formatCrashReportText(report, deferredNotes) : ''),
    [deferredNotes, report]
  )
  const copyCrashReportDetails = useCrashReportCopy(report, notes)

  const showReportFailure = (description: string): void => {
    toast.error(
      translate(
        'auto.components.crash.report.CrashReportDialog.githubReportFailed',
        "Crash report wasn't handed to GitHub"
      ),
      {
        id: CRASH_REPORT_GITHUB_FAILURE_TOAST_ID,
        description,
        duration: Infinity,
        dismissible: true
      }
    )
  }

  const dismissReportIfNeeded = async (): Promise<void> => {
    if (report?.status === 'pending') {
      await window.api.crashReports.dismiss({ reportId: report.id })
      if (mountedRef.current) {
        onReportChange({ ...report, status: 'dismissed' })
      }
    }
  }

  const handleDismiss = async (): Promise<void> => {
    await dismissReportIfNeeded()
    if (mountedRef.current) {
      onOpenChange(false)
    }
  }

  const handleReportOnGitHub = async (): Promise<void> => {
    setSubmitting(true)
    try {
      const result = await window.api.crashReports.reportOnGitHub({
        ...(report ? { reportId: report.id } : {}),
        notes
      })
      if (!result.ok) {
        showReportFailure(result.error)
        console.error('Failed to prepare the crash report issue:', result.error)
        return
      }
      await window.api.shell.openUrl(result.url)
      if (!mountedRef.current) {
        return
      }
      onReportChange(result.report)
      setNotes('')
      toast.dismiss(CRASH_REPORT_GITHUB_FAILURE_TOAST_ID)
      toast.success(
        result.bodyInUrl
          ? translate(
              'auto.components.crash.report.CrashReportDialog.githubReportOpened',
              'Opened a GitHub issue with the crash details. Review it before submitting.'
            )
          : translate(
              'auto.components.crash.report.CrashReportDialog.githubReportCopied',
              'Crash details copied. Paste them into the GitHub issue before submitting.'
            )
      )
      onOpenChange(false)
    } catch (error) {
      showReportFailure(
        translate(
          'auto.components.crash.report.CrashReportDialog.githubReportRetry',
          'Try again, or copy the details and open an issue yourself.'
        )
      )
      console.error('Failed to open the crash report issue:', error)
    } finally {
      if (mountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (submitting && !nextOpen) {
          return
        }
        if (!nextOpen) {
          void dismissReportIfNeeded().finally(() => {
            if (mountedRef.current) {
              onOpenChange(false)
            }
          })
          return
        }
        onOpenChange(true)
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="size-4 text-destructive" />
            {getDialogTitle(report)}
          </DialogTitle>
          <DialogDescription className="text-xs">{getDialogDescription(report)}</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          {report ? (
            <>
              <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs">
                <div className="font-medium text-foreground">{formatSummary(report)}</div>
                <div className="mt-1 text-muted-foreground">
                  {new Date(report.createdAt).toLocaleString()} · {report.platform} {report.arch} ·
                  {translate('auto.components.crash.report.CrashReportDialog.835037edc9', 'Orca')}{' '}
                  {report.appVersion}
                </div>
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground">
                  {translate(
                    'auto.components.crash.report.CrashReportDialog.6d3ebe216a',
                    'Diagnostic text'
                  )}
                </div>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border border-border bg-muted/20 p-3 font-mono text-[11px] leading-5 text-muted-foreground scrollbar-sleek">
                  {diagnosticText}
                </pre>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
              {loading
                ? translate(
                    'auto.components.crash.report.CrashReportDialog.765591798d',
                    'Checking for crash reports...'
                  )
                : translate(
                    'auto.components.crash.report.CrashReportDialog.ead6fc0510',
                    'No automatic crash report was captured. You can still open an issue with your notes and this build.'
                  )}
            </div>
          )}
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            placeholder={getNotesPlaceholder(report)}
            className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copyCrashReportDetails()}
            disabled={loading}
          >
            <Clipboard className="size-3.5" />
            {translate('auto.components.crash.report.CrashReportDialog.50b00dc327', 'Copy Details')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleDismiss()}
            disabled={submitting}
          >
            {translate('auto.components.crash.report.CrashReportDialog.notNow', 'Not now')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleReportOnGitHub()}
            disabled={loading || submitting}
          >
            <Github className="size-3.5" />
            {translate(
              'auto.components.crash.report.CrashReportDialog.reportOnGitHub',
              'Report on GitHub'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
