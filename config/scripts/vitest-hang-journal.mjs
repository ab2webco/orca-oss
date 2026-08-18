/**
 * Append-only journal of a vitest run's module lifecycle, plus the reader that
 * turns it into a hang diagnosis.
 *
 * Why a file and not stdout: the watchdog's whole signal is "the child has
 * printed nothing"; a diagnostic that printed would erase it. Why append-only:
 * the writer must survive being killed mid-run, and a rewritten snapshot of a
 * 300-file plan is not crash-safe.
 */

import { appendFileSync, readFileSync } from 'node:fs'

export const HANG_JOURNAL_ENV = 'ORCA_VITEST_HANG_JOURNAL'

/** @typedef {{event: string, atMs: number, module?: string, modules?: string[], reason?: string, pid?: number}} HangJournalEvent */

/**
 * @param {string} path
 * @param {HangJournalEvent} event
 */
export function appendHangJournalEvent(path, event) {
  appendFileSync(path, `${JSON.stringify(event)}\n`)
}

/**
 * @param {string} text raw journal contents
 * @returns {HangJournalEvent[]}
 */
function parseHangJournal(text) {
  const events = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }
    try {
      events.push(JSON.parse(trimmed))
    } catch {
      // A torn final line is expected when the writer is killed mid-append.
    }
  }
  return events
}

/**
 * @typedef {object} HangJournalSummary
 * @property {number|null} runStartedAtMs
 * @property {number|null} runEndedAtMs
 * @property {string|null} runEndReason
 * @property {number} plannedCount
 * @property {number} endedCount
 * @property {Array<{module: string, queuedAtMs: number, startedAtMs: number|null}>} suspects
 *   modules handed to a worker that never reported an end — the candidate set
 * @property {'no-journal'|'teardown-hang'|'wedged-modules'|'no-suspects'} verdict
 */

/**
 * Replays a journal into the set of modules that started and never finished.
 *
 * Why queued and not started: a module that blocks synchronously at import time
 * never reaches `onTestModuleStart`, which is exactly the case the watchdog
 * exists for. Queue is the last event the reporter is guaranteed to see.
 *
 * @param {string|null} text raw journal contents, or null when it is missing
 * @returns {HangJournalSummary}
 */
export function summarizeHangJournal(text) {
  /** @type {HangJournalSummary} */
  const summary = {
    runStartedAtMs: null,
    runEndedAtMs: null,
    runEndReason: null,
    plannedCount: 0,
    endedCount: 0,
    suspects: [],
    verdict: 'no-journal'
  }
  if (text === null) {
    return summary
  }

  /** @type {Map<string, {queuedAtMs: number, startedAtMs: number|null}>} */
  const open = new Map()
  for (const event of parseHangJournal(text)) {
    if (event.event === 'run-start') {
      summary.runStartedAtMs = event.atMs
      summary.plannedCount = event.modules?.length ?? 0
    } else if (event.event === 'module-queued' && event.module) {
      open.set(event.module, { queuedAtMs: event.atMs, startedAtMs: null })
    } else if (event.event === 'module-start' && event.module) {
      const entry = open.get(event.module) ?? { queuedAtMs: event.atMs, startedAtMs: null }
      entry.startedAtMs = event.atMs
      open.set(event.module, entry)
    } else if (event.event === 'module-end' && event.module) {
      open.delete(event.module)
      summary.endedCount += 1
    } else if (event.event === 'run-end') {
      summary.runEndedAtMs = event.atMs
      summary.runEndReason = event.reason ?? null
    }
  }

  summary.suspects = [...open.entries()]
    .map(([module, times]) => ({ module, ...times }))
    .sort((a, b) => a.queuedAtMs - b.queuedAtMs)

  if (summary.runStartedAtMs === null) {
    summary.verdict = 'no-journal'
  } else if (summary.runEndedAtMs !== null) {
    summary.verdict = 'teardown-hang'
  } else if (summary.suspects.length > 0) {
    summary.verdict = 'wedged-modules'
  } else {
    summary.verdict = 'no-suspects'
  }
  return summary
}

/**
 * @param {string} path
 * @returns {HangJournalSummary}
 */
export function readHangJournalSummary(path) {
  let text = null
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    text = null
  }
  return summarizeHangJournal(text)
}
