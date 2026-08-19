/**
 * Aggregates Playwright JSON reports into a per-spec failure rate.
 *
 * One report is one shard of one run attempt. Attempts are kept apart: re-running
 * a shard replaces the job, so an attempt collapsed into its re-run would hide the
 * failure the re-run was started for.
 */

/**
 * @typedef {'passed' | 'failed' | 'flaky' | 'fixme' | 'skipped' | 'interrupted'} TestOutcome
 * @typedef {{ file: string, line: number, title: string, project: string, outcome: TestOutcome, reason: string | null }} TestObservation
 * @typedef {{ runId: string, attempt: string, runKey: string, source: string, shard: { current: number, total: number } | null, observations: TestObservation[] }} ParsedReport
 * @typedef {{ key: string, file: string, title: string, line: number, executions: number, failures: number, flaky: number, fixme: number, skipped: number, interrupted: number, failureRate: number | null, failedIn: string[], reasons: string[] }} SpecRate
 * @typedef {{ runKey: string, runId: string, attempt: string, reports: number, shardTotal: number | null, shardsSeen: number[], missingShards: number[] }} RunCoverage
 */

export const TEST_OUTCOME = Object.freeze({
  PASSED: 'passed',
  FAILED: 'failed',
  FLAKY: 'flaky',
  FIXME: 'fixme',
  SKIPPED: 'skipped',
  INTERRUPTED: 'interrupted'
})

// Only these three ran far enough to have judged anything.
const EXECUTED_OUTCOMES = new Set([TEST_OUTCOME.PASSED, TEST_OUTCOME.FAILED, TEST_OUTCOME.FLAKY])

/**
 * @param {Record<string, unknown>} test
 * @returns {TestOutcome}
 */
function resolveOutcome(test) {
  const results = Array.isArray(test.results) ? test.results : []
  // Checked before status: an aborted worker leaves a test that never judged
  // anything, and counting it either way moves a rate it did not measure.
  if (results.some((result) => result.status === 'interrupted')) {
    return TEST_OUTCOME.INTERRUPTED
  }
  if (test.status === 'expected') {
    return TEST_OUTCOME.PASSED
  }
  if (test.status === 'unexpected') {
    return TEST_OUTCOME.FAILED
  }
  if (test.status === 'flaky') {
    return TEST_OUTCOME.FLAKY
  }
  const annotations = [
    ...(Array.isArray(test.annotations) ? test.annotations : []),
    ...results.flatMap((result) => (Array.isArray(result.annotations) ? result.annotations : []))
  ]
  return annotations.some((annotation) => annotation.type === 'fixme')
    ? TEST_OUTCOME.FIXME
    : TEST_OUTCOME.SKIPPED
}

/** @param {Record<string, unknown>} test @param {TestOutcome} outcome */
function resolveReason(test, outcome) {
  const results = Array.isArray(test.results) ? test.results : []
  if (outcome === TEST_OUTCOME.FAILED || outcome === TEST_OUTCOME.FLAKY) {
    const error = results.flatMap((result) => result.errors ?? []).find((entry) => entry.message)
    return error ? firstLine(stripAnsi(String(error.message))) : null
  }
  const annotations = [
    ...(Array.isArray(test.annotations) ? test.annotations : []),
    ...results.flatMap((result) => (Array.isArray(result.annotations) ? result.annotations : []))
  ]
  const described = annotations.find((annotation) => annotation.description)
  return described ? String(described.description) : null
}

// Built at runtime: a literal escape byte in a regex is a lint error.
const ANSI_PATTERN = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, 'g')

/** @param {string} text */
function stripAnsi(text) {
  return text.replaceAll(ANSI_PATTERN, '')
}

/** @param {string} text */
function firstLine(text) {
  return text.split('\n', 1)[0]?.trim() ?? ''
}

/** @param {string} file @param {string} title */
export function specKey(file, title) {
  return `${file} › ${title}`
}

/**
 * @param {Record<string, unknown>} suite
 * @param {string[]} titlePath
 * @param {TestObservation[]} collected
 */
function collectSuite(suite, titlePath, collected) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const outcome = resolveOutcome(test)
      collected.push({
        file: String(spec.file),
        line: Number(spec.line ?? 0),
        title: [...titlePath, String(spec.title)].join(' › '),
        project: String(test.projectName ?? ''),
        outcome,
        reason: resolveReason(test, outcome)
      })
    }
  }
  for (const child of suite.suites ?? []) {
    // The outermost suite title is the file itself; it would repeat in every title.
    const isFileSuite = titlePath.length === 0 && child.title === child.file
    collectSuite(child, isFileSuite ? titlePath : [...titlePath, String(child.title)], collected)
  }
}

/**
 * @param {Record<string, unknown>} report parsed Playwright JSON report
 * @param {string} source label used when the report cannot identify its run
 * @returns {ParsedReport}
 */
export function parseReport(report, source) {
  const config = report.config ?? {}
  const metadata = config.metadata ?? {}
  const runId = String(metadata.orcaRunId ?? 'unknown')
  const attempt = String(metadata.orcaRunAttempt ?? '1')
  const observations = []
  for (const suite of report.suites ?? []) {
    const isFileSuite = suite.title === suite.file
    collectSuite(suite, isFileSuite ? [] : [String(suite.title)], observations)
  }
  return {
    runId,
    attempt,
    // An unidentified report is its own run: merging two would invent a denominator.
    runKey: runId === 'unknown' ? `${source}` : `${runId}#${attempt}`,
    source,
    shard: config.shard
      ? { current: Number(config.shard.current), total: Number(config.shard.total) }
      : null,
    observations
  }
}

/** @param {ParsedReport[]} reports @returns {RunCoverage[]} */
function summarizeRuns(reports) {
  /** @type {Map<string, RunCoverage>} */
  const runs = new Map()
  for (const report of reports) {
    const existing = runs.get(report.runKey) ?? {
      runKey: report.runKey,
      runId: report.runId,
      attempt: report.attempt,
      reports: 0,
      shardTotal: null,
      shardsSeen: [],
      missingShards: []
    }
    existing.reports += 1
    if (report.shard) {
      existing.shardTotal = report.shard.total
      if (!existing.shardsSeen.includes(report.shard.current)) {
        existing.shardsSeen.push(report.shard.current)
      }
    }
    runs.set(report.runKey, existing)
  }
  for (const run of runs.values()) {
    run.shardsSeen.sort((left, right) => left - right)
    if (run.shardTotal !== null) {
      // A shard that wedged or timed out uploads nothing; without this its specs
      // silently leave the denominator instead of being named.
      run.missingShards = Array.from({ length: run.shardTotal }, (_, index) => index + 1).filter(
        (shard) => !run.shardsSeen.includes(shard)
      )
    }
  }
  return [...runs.values()].sort((left, right) => left.runKey.localeCompare(right.runKey))
}

/**
 * @param {ParsedReport[]} reports
 * @returns {{ runs: RunCoverage[], specs: SpecRate[], files: string[], totals: Record<string, number> }}
 */
export function aggregateReports(reports) {
  /** @type {Map<string, SpecRate>} */
  const specs = new Map()
  for (const report of reports) {
    for (const observation of report.observations) {
      const key = specKey(observation.file, observation.title)
      const entry = specs.get(key) ?? {
        key,
        file: observation.file,
        title: observation.title,
        line: observation.line,
        executions: 0,
        failures: 0,
        flaky: 0,
        fixme: 0,
        skipped: 0,
        interrupted: 0,
        failureRate: null,
        failedIn: [],
        reasons: []
      }
      if (EXECUTED_OUTCOMES.has(observation.outcome)) {
        entry.executions += 1
      }
      if (observation.outcome === TEST_OUTCOME.FAILED) {
        entry.failures += 1
        entry.failedIn.push(report.runKey)
      }
      if (observation.outcome === TEST_OUTCOME.FLAKY) {
        entry.flaky += 1
      }
      if (observation.outcome === TEST_OUTCOME.FIXME) {
        entry.fixme += 1
      }
      if (observation.outcome === TEST_OUTCOME.SKIPPED) {
        entry.skipped += 1
      }
      if (observation.outcome === TEST_OUTCOME.INTERRUPTED) {
        entry.interrupted += 1
      }
      if (observation.reason && !entry.reasons.includes(observation.reason)) {
        entry.reasons.push(observation.reason)
      }
      specs.set(key, entry)
    }
  }
  for (const entry of specs.values()) {
    entry.failureRate = entry.executions === 0 ? null : entry.failures / entry.executions
  }
  const ordered = [...specs.values()].sort(
    (left, right) =>
      (right.failureRate ?? -1) - (left.failureRate ?? -1) || left.key.localeCompare(right.key)
  )
  const files = [...new Set(ordered.map((entry) => entry.file))].sort()
  return {
    runs: summarizeRuns(reports),
    specs: ordered,
    files,
    totals: {
      reports: reports.length,
      executions: sumOf(ordered, 'executions'),
      failures: sumOf(ordered, 'failures'),
      flaky: sumOf(ordered, 'flaky'),
      fixme: sumOf(ordered, 'fixme'),
      skipped: sumOf(ordered, 'skipped'),
      interrupted: sumOf(ordered, 'interrupted'),
      failingSpecs: ordered.filter((entry) => entry.failures > 0).length,
      neverExecuted: ordered.filter((entry) => entry.executions === 0).length
    }
  }
}

/** @param {SpecRate[]} specs @param {keyof SpecRate} field */
function sumOf(specs, field) {
  return specs.reduce((total, entry) => total + Number(entry[field]), 0)
}

/** @param {number | null} rate */
export function formatRate(rate) {
  return rate === null ? 'n/a' : `${Math.round(rate * 1000) / 10}%`
}
