import os from 'node:os'
import { app, ipcMain } from 'electron'
import { buildForkIssueUrl, truncateIssueTitle } from '../fork-issue-url'

export type FeedbackIssueDraft = {
  url: string
  /** The complete report, whether or not the URL already carries it. */
  body: string
  /** False when the body was too long to prefill and must be pasted instead. */
  bodyInUrl: boolean
}

function buildBody(feedback: string): string {
  return [
    feedback.trim(),
    '',
    '---',
    `Orca ${app.getVersion()} · ${process.platform} ${os.release()} · ${process.arch}`
  ].join('\n')
}

export function buildFeedbackIssueDraft(feedback: string): FeedbackIssueDraft {
  const body = buildBody(feedback)
  const title = truncateIssueTitle(feedback.trim().split('\n')[0] ?? '', 'Orca feedback')
  return { ...buildForkIssueUrl(title, body), body }
}

export function registerFeedbackHandlers(): void {
  ipcMain.removeHandler('feedback:composeIssue')
  // Why main rather than the renderer: the app version and OS release are the
  // part of a report the renderer cannot be trusted to state, and they are the
  // only reason this crosses IPC at all.
  ipcMain.handle('feedback:composeIssue', (_event, args: { feedback: string }) =>
    buildFeedbackIssueDraft(typeof args?.feedback === 'string' ? args.feedback : '')
  )
}
