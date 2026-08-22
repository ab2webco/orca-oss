/**
 * Self-classifying evidence for the dominant E2E failure mode: Playwright's
 * `page.evaluate: Execution context was destroyed, most likely because of a
 * navigation.` See docs/reference/renderer-recovery-reload.md.
 *
 * Orca's own crash-recovery reload (src/main/index.ts `onBeforeRecoveryReload`)
 * only ever runs after `webContents.on('render-process-gone')` fires with a
 * crash-report reason, and that same event unconditionally persists a
 * `CrashReportRecord` (source: 'renderer') to `<userData>/crash-reports.json`
 * (src/main/crash-reporting/process-gone-recorder.ts) before the reload is
 * even scheduled. That file is unconditional — unlike the NDJSON trace sink,
 * it is not gated by CI/telemetry consent — so it is the one durable, on-disk
 * signal that survives the renderer dying and is still readable after the
 * test's userData dir is about to be deleted.
 *
 * The persisted record does not carry `expectedTeardown`, so a `reason`
 * alone cannot always *prove* the reload ran — but for every reason except
 * `integrity-failure` it is strong evidence, once the recorder's own filter
 * is accounted for. `shouldRecordProcessGoneCrash`
 * (process-gone-classification.ts) only ever suppresses a `reason: 'killed'`
 * record when `expectedTeardown` is `'app-shutdown'` or `'renderer-reload'`;
 * a `'killed'` record that made it to disk therefore already implies
 * `expectedTeardown === 'none'`, which is exactly the case
 * `shouldRecoverRendererAfterProcessGone` returns true for (empirically
 * verified on macOS in ORCA-280 via `forcefullyCrashRenderer()`, which
 * reports `reason: 'killed'` there and does recover; not yet checked on
 * Linux CI). LIKELY is still an inference on top of that: `scheduleRendererRecovery`
 * (createMainWindow.ts) can bail after this check passes — `windowClosing`,
 * `getIsQuitting()`, or a tripped circuit breaker (3 recoveries/60s) — so a
 * LIKELY-classified record does not *guarantee* the reload ran. Two
 * confidence tiers follow:
 *   - CONFIRMED: a `renderer_recovery_reload` breadcrumb was found. This
 *     breadcrumb is only carried on disk inside a *later* crash record's
 *     `breadcrumbs` snapshot (durable-crash-breadcrumb.ts), so it requires a
 *     second crash in the same run — rare for a single-crash test failure.
 *   - LIKELY: a renderer-source crash record exists whose `reason` is not
 *     `integrity-failure` (the one reason `shouldRecoverRendererAfterProcessGone`
 *     always refuses), so the reload was very likely scheduled even though
 *     nothing on disk directly proves it fired.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { TestInfo } from '@stablyai/playwright-test'
import type { CrashReportRecord } from '../../../src/shared/crash-reporting'

// Why: mirrors NON_RECOVERABLE_RENDERER_REASONS in
// src/main/crash-reporting/process-gone-classification.ts. 'killed' is
// deliberately excluded from this set — see the module doc comment above for
// why a persisted 'killed' record already implies recovery ran.
const NON_RECOVERABLE_REASONS = new Set(['integrity-failure'])

export type RendererRecoveryEvidence = {
  /** A renderer-source crash record was found in crash-reports.json. */
  rendererCrashRecorded: boolean
  /** Direct evidence: a `renderer_recovery_reload` breadcrumb was found. */
  recoveryReloadConfirmed: boolean
  /** Inferred evidence: a crash reason was recorded that recovers by default. */
  recoveryReloadLikely: boolean
  /** Distinct `reason` values off matching renderer-source crash records. */
  crashReasons: string[]
  /** How many renderer-source crash records were found. */
  rendererCrashRecordCount: number
  /** How many `renderer_recovery_reload` breadcrumbs were found across all records. */
  recoveryBreadcrumbCount: number
  /** Human-readable line safe to print directly into the job log. */
  detail: string
}

type CrashReportFile = {
  reports?: unknown
}

function isCrashReportRecord(value: unknown): value is CrashReportRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return typeof record.source === 'string' && typeof record.reason === 'string'
}

function countRecoveryBreadcrumbs(records: CrashReportRecord[]): number {
  let count = 0
  for (const record of records) {
    for (const breadcrumb of record.breadcrumbs ?? []) {
      if (breadcrumb.name === 'renderer_recovery_reload') {
        count += 1
      }
    }
  }
  return count
}

function noEvidenceResult(detail: string): RendererRecoveryEvidence {
  return {
    rendererCrashRecorded: false,
    recoveryReloadConfirmed: false,
    recoveryReloadLikely: false,
    crashReasons: [],
    rendererCrashRecordCount: 0,
    recoveryBreadcrumbCount: 0,
    detail
  }
}

function buildEvidence(records: CrashReportRecord[]): RendererRecoveryEvidence {
  const rendererRecords = records.filter((record) => record.source === 'renderer')
  const recoveryBreadcrumbCount = countRecoveryBreadcrumbs(records)
  const crashReasons = [...new Set(rendererRecords.map((record) => record.reason))]
  const rendererCrashRecorded = rendererRecords.length > 0
  const recoveryReloadConfirmed = recoveryBreadcrumbCount > 0
  const recoveryReloadLikely =
    !recoveryReloadConfirmed &&
    rendererRecords.some((record) => !NON_RECOVERABLE_REASONS.has(record.reason))

  if (!rendererCrashRecorded && !recoveryReloadConfirmed) {
    return noEvidenceResult(
      records.length === 0
        ? `renderer_recovery_reload: did not fire — crash-reports.json in the E2E ` +
            `user-data dir has no records; Orca never observed a render-process-gone event.`
        : `renderer_recovery_reload: did not fire — crash-reports.json exists but ` +
            `contains no renderer-source crash record (${records.length} unrelated record(s)).`
    )
  }

  const reasonList = `reason(s)=[${crashReasons.join(', ')}]`
  const detail = recoveryReloadConfirmed
    ? `renderer_recovery_reload: CONFIRMED — crash-reports.json carries ` +
      `${recoveryBreadcrumbCount} renderer_recovery_reload breadcrumb(s) alongside ` +
      `${rendererRecords.length} renderer crash record(s), ${reasonList}.`
    : recoveryReloadLikely
      ? `renderer_recovery_reload: LIKELY (not directly confirmed) — crash-reports.json ` +
        `recorded ${rendererRecords.length} renderer crash(es), ${reasonList}; that reason ` +
        `recovers by default per shouldRecoverRendererAfterProcessGone.`
      : `renderer crash recorded but recovery reload did NOT run — ` +
        `crash-reports.json recorded ${rendererRecords.length} renderer crash(es), ` +
        `${reasonList}, which shouldRecoverRendererAfterProcessGone always refuses.`

  return {
    rendererCrashRecorded,
    recoveryReloadConfirmed,
    recoveryReloadLikely,
    crashReasons,
    rendererCrashRecordCount: rendererRecords.length,
    recoveryBreadcrumbCount,
    detail
  }
}

/**
 * Read `<userDataDir>/crash-reports.json` and classify whether Orca's own
 * renderer-crash-recovery reload ran during this test. Never throws — a
 * missing or unreadable file is a real finding ("did not fire"), not an error.
 */
export async function readRendererRecoveryEvidence(
  userDataDir: string
): Promise<RendererRecoveryEvidence> {
  const filePath = path.join(userDataDir, 'crash-reports.json')
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return noEvidenceResult(
      'renderer_recovery_reload: did not fire — crash-reports.json was never written to ' +
        'the E2E user-data dir, so Orca never recorded a renderer process-gone event.'
    )
  }

  let parsed: CrashReportFile
  try {
    parsed = JSON.parse(raw) as CrashReportFile
  } catch {
    return noEvidenceResult(
      'renderer_recovery_reload: undetermined — crash-reports.json was unreadable JSON.'
    )
  }

  const reports = Array.isArray(parsed.reports) ? parsed.reports : []
  const records = reports.filter(isCrashReportRecord)
  return buildEvidence(records)
}

/** One-line, job-log-safe summary tying the evidence to a specific test. */
export function formatRendererRecoveryEvidenceLine(
  testTitle: string,
  evidence: RendererRecoveryEvidence
): string {
  return `[renderer-recovery-evidence] ${testTitle} :: ${evidence.detail}`
}

/**
 * Fixture-teardown hook: on a non-passing test, read and report the renderer
 * recovery evidence before the caller deletes `userDataDir`. Gated on status
 * so the passing path never pays for a file read; never throws so a
 * diagnostics failure cannot mask the real test failure.
 */
export async function reportRendererRecoveryEvidenceOnFailure(
  userDataDir: string,
  testInfo: TestInfo
): Promise<void> {
  if (testInfo.status === 'passed' || testInfo.status === 'skipped') {
    return
  }
  try {
    const evidence = await readRendererRecoveryEvidence(userDataDir)
    console.log(formatRendererRecoveryEvidenceLine(testInfo.titlePath.join(' > '), evidence))
    await testInfo.attach('renderer-recovery-evidence.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json'
    })
  } catch (error) {
    console.error('[renderer-recovery-evidence] failed to collect evidence:', error)
  }
}
