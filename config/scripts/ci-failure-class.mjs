/**
 * Classifies a GitHub Actions run's non-successful jobs from API signals alone.
 *
 * Why: a job killed by `timeout-minutes`, a job whose setup step failed, and a job
 * with a red test all surface as `fail` in the checks UI, so triage goes to the
 * wrong place (ORCA-215). Each leaves a distinct trace in
 * `GET /actions/runs/{id}/jobs`; this turns that trace into a named class.
 * Signal-per-class table: docs/reference/ci-failure-classification.md.
 */

export const CI_FAILURE_CLASS = Object.freeze({
  TIMEOUT: 'timeout',
  CANCELLED_BY_RUN: 'cancelled-by-run',
  CANCELLED_BY_FAIL_FAST: 'cancelled-by-fail-fast',
  SETUP_FAILED: 'setup-failed',
  TESTS_FAILED: 'tests-failed',
  GATE_FAILED: 'gate-failed',
  DEPENDENCY_SKIPPED: 'dependency-skipped',
  PENDING: 'pending',
  UNCLASSIFIED: 'unclassified'
})

/**
 * Where each class sends the reader. `none` means the job did not fail on its own
 * account and must not be read as a red test.
 */
export const CI_FAILURE_TRIAGE = Object.freeze({
  [CI_FAILURE_CLASS.TIMEOUT]: 'budget',
  [CI_FAILURE_CLASS.CANCELLED_BY_RUN]: 'none',
  [CI_FAILURE_CLASS.CANCELLED_BY_FAIL_FAST]: 'none',
  [CI_FAILURE_CLASS.SETUP_FAILED]: 'setup',
  [CI_FAILURE_CLASS.TESTS_FAILED]: 'code',
  [CI_FAILURE_CLASS.GATE_FAILED]: 'none',
  [CI_FAILURE_CLASS.DEPENDENCY_SKIPPED]: 'none',
  [CI_FAILURE_CLASS.PENDING]: 'none',
  [CI_FAILURE_CLASS.UNCLASSIFIED]: 'unknown'
})

// Why 60s: the runner kills the job a few seconds past the cap and `started_at`
// includes runner setup — job 94316018103 measured 30m17s against a 30m cap.
const TIMEOUT_GRACE_SECONDS = 60

// Why 120s: fail-fast cancels siblings as soon as the failure is reported, so a
// sibling still running two minutes later was cancelled by something else.
const FAIL_FAST_WINDOW_SECONDS = 120

// Runner-injected steps: they exist on every job and say nothing about the work.
const RUNNER_MANAGED_STEP = /^(?:Set up job|Complete job|Post .+)$/

function elapsedSeconds(job) {
  const started = Date.parse(job.started_at ?? '')
  const completed = Date.parse(job.completed_at ?? '')
  if (Number.isNaN(started) || Number.isNaN(completed)) {
    return null
  }
  return Math.round((completed - started) / 1000)
}

export function formatDuration(seconds) {
  if (seconds === null) {
    return 'unknown duration'
  }
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0 ? `${minutes}m${String(rest).padStart(2, '0')}s` : `${rest}s`
}

function executableSteps(job) {
  return (job.steps ?? []).filter((step) => !RUNNER_MANAGED_STEP.test(step.name ?? ''))
}

function findFailFastTrigger(job, siblings) {
  const completed = Date.parse(job.completed_at ?? '')
  if (Number.isNaN(completed)) {
    return null
  }
  for (const sibling of siblings) {
    if (sibling.id === job.id || sibling.conclusion !== 'failure') {
      continue
    }
    const siblingCompleted = Date.parse(sibling.completed_at ?? '')
    if (Number.isNaN(siblingCompleted)) {
      continue
    }
    const gapSeconds = (completed - siblingCompleted) / 1000
    if (gapSeconds >= 0 && gapSeconds <= FAIL_FAST_WINDOW_SECONDS) {
      return sibling
    }
  }
  return null
}

function classifyCancelledJob(job, { runConclusion, timeoutMinutes, siblings }) {
  const seconds = elapsedSeconds(job)
  const reachedCap =
    timeoutMinutes !== null &&
    seconds !== null &&
    seconds >= timeoutMinutes * 60 - TIMEOUT_GRACE_SECONDS
  if (reachedCap) {
    return {
      failureClass: CI_FAILURE_CLASS.TIMEOUT,
      evidence: `job conclusion "cancelled" after ${formatDuration(seconds)} against its ${timeoutMinutes}-minute cap`
    }
  }
  if (runConclusion === 'cancelled') {
    return {
      failureClass: CI_FAILURE_CLASS.CANCELLED_BY_RUN,
      evidence: `run conclusion "cancelled" — the whole run was superseded or cancelled after ${formatDuration(seconds)}`
    }
  }
  const trigger = findFailFastTrigger(job, siblings)
  if (trigger) {
    return {
      failureClass: CI_FAILURE_CLASS.CANCELLED_BY_FAIL_FAST,
      evidence: `cancelled seconds after sibling "${trigger.name}" failed — fail-fast, not a failure of this job`
    }
  }
  return {
    failureClass: CI_FAILURE_CLASS.UNCLASSIFIED,
    evidence:
      timeoutMinutes === null
        ? `cancelled after ${formatDuration(seconds)} and no timeout-minutes could be resolved for this job`
        : `cancelled after ${formatDuration(seconds)}, short of its ${timeoutMinutes}-minute cap, with no cancelled run and no failed sibling`
  }
}

function classifyFailedJob(job) {
  const steps = executableSteps(job)
  const failed = steps.find((step) => step.conclusion === 'failure')
  if (!failed) {
    return {
      failureClass: CI_FAILURE_CLASS.UNCLASSIFIED,
      evidence: 'job conclusion "failure" with no failing step — runner or workflow-level error'
    }
  }
  const neverReachedTheEnd = steps.some(
    (step) => step.number > failed.number && step.conclusion === 'skipped'
  )
  if (neverReachedTheEnd) {
    return {
      failureClass: CI_FAILURE_CLASS.SETUP_FAILED,
      evidence: `step "${failed.name}" failed and later steps were skipped — the job's work never ran`,
      step: failed.name
    }
  }
  return {
    failureClass: CI_FAILURE_CLASS.TESTS_FAILED,
    evidence: `step "${failed.name}" ran to completion and failed`,
    step: failed.name
  }
}

function classifyOneJob(job, context) {
  if (job.status !== 'completed') {
    return {
      failureClass: CI_FAILURE_CLASS.PENDING,
      evidence: `still ${job.status ?? 'queued'} when the run was classified`
    }
  }
  if (job.conclusion === 'skipped') {
    return {
      failureClass: CI_FAILURE_CLASS.DEPENDENCY_SKIPPED,
      evidence: 'job conclusion "skipped" — a dependency or an `if` condition kept it from running'
    }
  }
  // Why this order: only `cancelled` can ever be a timeout. A job that reported
  // `failure` is never reclassified by duration, which is the mask this change
  // exists to prevent.
  if (job.conclusion === 'cancelled') {
    return classifyCancelledJob(job, context)
  }
  if (job.conclusion === 'failure') {
    // Why gates are named rather than detected: a gate job's only step echoes
    // `needs.*.result`, so by shape it is indistinguishable from a job whose work
    // step ran and failed — and calling `verify` "a test failed" is the same lie
    // this exists to kill, pointed the other way.
    if (context.gateJobNames.has(job.name)) {
      return {
        failureClass: CI_FAILURE_CLASS.GATE_FAILED,
        evidence:
          'a merge gate: it failed because a job it depends on did, and carries no diagnosis of its own'
      }
    }
    return classifyFailedJob(job)
  }
  return {
    failureClass: CI_FAILURE_CLASS.UNCLASSIFIED,
    evidence: `unexpected job conclusion "${job.conclusion}"`
  }
}

/**
 * @param {object} input
 * @param {{conclusion?: string|null}} input.run trimmed `GET /actions/runs/{id}`
 * @param {Array<object>} input.jobs trimmed `GET /actions/runs/{id}/jobs`
 * @param {(jobName: string) => ({workflowFile: string, jobKey: string, timeoutMinutes: number|null}|null)} [input.resolveJobDefinition]
 * @param {Array<string>} [input.gateJobNames] jobs that only echo other jobs' results
 * @param {Array<string>} [input.excludedJobNames] jobs to leave out entirely — the
 *   reporter is `in_progress` in its own API response and would report on itself
 * @returns {Array<object>} one entry per job that is not `success`
 */
export function classifyRunJobs({
  run,
  jobs,
  resolveJobDefinition,
  gateJobNames = [],
  excludedJobNames = []
}) {
  const resolve = resolveJobDefinition ?? (() => null)
  const gates = new Set(gateJobNames)
  const excluded = new Set(excludedJobNames)
  const definitions = new Map()
  const siblingsByKey = new Map()
  for (const job of jobs) {
    const definition = resolve(job.name) ?? null
    definitions.set(job.id, definition)
    if (!definition) {
      continue
    }
    const key = `${definition.workflowFile}#${definition.jobKey}`
    if (!siblingsByKey.has(key)) {
      siblingsByKey.set(key, [])
    }
    siblingsByKey.get(key).push(job)
  }

  const classified = []
  for (const job of jobs) {
    if (job.status === 'completed' && job.conclusion === 'success') {
      continue
    }
    if (excluded.has(job.name)) {
      continue
    }
    const definition = definitions.get(job.id)
    const key = definition ? `${definition.workflowFile}#${definition.jobKey}` : null
    const outcome = classifyOneJob(job, {
      runConclusion: run?.conclusion ?? null,
      timeoutMinutes: definition?.timeoutMinutes ?? null,
      siblings: (key && siblingsByKey.get(key)) || [],
      gateJobNames: gates
    })
    classified.push({
      id: job.id,
      name: job.name,
      url: job.html_url ?? null,
      conclusion: job.conclusion ?? null,
      durationSeconds: elapsedSeconds(job),
      timeoutMinutes: definition?.timeoutMinutes ?? null,
      triage: CI_FAILURE_TRIAGE[outcome.failureClass],
      ...outcome
    })
  }
  return classified
}
