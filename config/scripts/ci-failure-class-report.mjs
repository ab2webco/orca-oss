/**
 * Renders classified CI jobs onto surfaces that are readable without opening a
 * log: the run's job summary and workflow annotations.
 */

import { CI_FAILURE_CLASS, formatDuration } from './ci-failure-class.mjs'

const HEADLINE = {
  [CI_FAILURE_CLASS.TIMEOUT]: 'ran out of time — no test failed',
  [CI_FAILURE_CLASS.CANCELLED_BY_RUN]: 'cancelled with the whole run — not a failure',
  [CI_FAILURE_CLASS.CANCELLED_BY_FAIL_FAST]: 'cancelled by another job — not a failure',
  [CI_FAILURE_CLASS.SETUP_FAILED]: 'a step failed before the tests ran',
  [CI_FAILURE_CLASS.HANG]: 'a test file wedged — no test failed',
  [CI_FAILURE_CLASS.TESTS_FAILED]: 'a test failed',
  [CI_FAILURE_CLASS.GATE_FAILED]: 'failed because a job it depends on failed',
  [CI_FAILURE_CLASS.DEPENDENCY_SKIPPED]: 'never ran — a dependency kept it out',
  [CI_FAILURE_CLASS.PENDING]: 'still running when the run was classified',
  [CI_FAILURE_CLASS.UNCLASSIFIED]: 'signals disagree — open the log'
}

// Order the reader should triage in: real failures first, non-failures last.
const CLASS_ORDER = [
  CI_FAILURE_CLASS.TESTS_FAILED,
  CI_FAILURE_CLASS.SETUP_FAILED,
  CI_FAILURE_CLASS.UNCLASSIFIED,
  CI_FAILURE_CLASS.TIMEOUT,
  CI_FAILURE_CLASS.CANCELLED_BY_FAIL_FAST,
  CI_FAILURE_CLASS.CANCELLED_BY_RUN,
  CI_FAILURE_CLASS.GATE_FAILED,
  CI_FAILURE_CLASS.DEPENDENCY_SKIPPED,
  CI_FAILURE_CLASS.PENDING
]

const ANNOTATION_SEVERITY = { code: 'warning', setup: 'warning', unknown: 'warning' }

export function sortClassifiedJobs(classified) {
  return [...classified].sort((left, right) => {
    const byClass = CLASS_ORDER.indexOf(left.failureClass) - CLASS_ORDER.indexOf(right.failureClass)
    return byClass !== 0 ? byClass : left.name.localeCompare(right.name)
  })
}

function escapeCell(text) {
  return String(text).replaceAll('|', '\\|')
}

export function renderJobSummary(classified) {
  if (classified.length === 0) {
    return '## CI failure class\n\nEvery job in this run succeeded.\n'
  }
  const rows = sortClassifiedJobs(classified).map((entry) => {
    const duration = formatDuration(entry.durationSeconds)
    const cap = entry.timeoutMinutes === null ? 'no cap' : `${entry.timeoutMinutes}m cap`
    const name = entry.url ? `[${escapeCell(entry.name)}](${entry.url})` : escapeCell(entry.name)
    return `| ${name} | \`${entry.failureClass}\` | ${escapeCell(HEADLINE[entry.failureClass])} | ${duration} / ${cap} | ${escapeCell(entry.evidence)} |`
  })
  const realFailures = classified.filter(
    (entry) => entry.triage === 'code' || entry.triage === 'setup'
  ).length
  const headline =
    realFailures === 0
      ? 'No job in this run failed on its own account.'
      : `${realFailures} job(s) failed on their own account; the rest below did not.`
  return [
    '## CI failure class',
    '',
    headline,
    '',
    '| Job | Class | What it means | Ran | API signal |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    'Classes and the signal behind each: `docs/reference/ci-failure-classification.md`.',
    ''
  ].join('\n')
}

export function renderAnnotations(classified) {
  return sortClassifiedJobs(classified)
    .filter((entry) => entry.failureClass !== CI_FAILURE_CLASS.PENDING)
    .map((entry) => {
      const severity = ANNOTATION_SEVERITY[entry.triage] ?? 'notice'
      const title = `${entry.failureClass}: ${entry.name}`
      // Workflow commands break on raw newlines; the evidence is a single line.
      return `::${severity} title=${title}::${entry.evidence}`
    })
}
