/**
 * Decides whether a lab release may publish, from the classified jobs of the
 * test signal that ran against the exact tree being released.
 *
 * Why a module and not shell in the workflow: the YAML cannot be tested, and the
 * one thing this must never do is read a run that did not finish as "green".
 * Failure classes come from ci-failure-class.mjs — a wedged shard and a red test
 * are the same `failure` in the jobs API.
 */

import { CI_FAILURE_CLASS } from './ci-failure-class.mjs'

export const RELEASE_GATE_REASON = Object.freeze({
  GREEN: 'signal-green',
  RED: 'signal-red',
  INFRA_ONLY: 'signal-infra-only',
  INDETERMINATE: 'signal-indeterminate',
  SKIPPED: 'gate-skipped',
  SKIP_UNJUSTIFIED: 'gate-skip-unjustified'
})

/**
 * The only classes a release candidate may proceed through: the job ran and was
 * killed by a budget or by a sibling, so nothing asserted a failure. A shard that
 * never ran leaves the suite unproven and is indeterminate, not tolerated.
 * The `--latest` lane tolerates none of them — a run that did not finish cannot
 * be read as green, or any infra hiccup silently disarms the gate.
 */
const RELEASE_CANDIDATE_TOLERATED_CLASSES = new Set([
  CI_FAILURE_CLASS.TIMEOUT,
  CI_FAILURE_CLASS.HANG,
  CI_FAILURE_CLASS.CANCELLED_BY_FAIL_FAST
])

function normalizeSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : null
}

function describeJobs(jobs) {
  return jobs.map((job) => `${job.name} (${job.failureClass}: ${job.evidence})`)
}

function indeterminate(detail) {
  return {
    publish: false,
    reason: RELEASE_GATE_REASON.INDETERMINATE,
    headline: 'the release signal could not be read — refusing to publish',
    detail,
    blockingJobs: []
  }
}

/**
 * @param {object} input
 * @param {string|null} input.releaseSha commit the release will be built from
 * @param {string|null} input.verifiedSha commit the signal actually ran against
 * @param {number} input.expectedJobCount signal jobs the workflow declares
 * @param {number} input.observedJobCount signal jobs the jobs API reported
 * @param {Array<object>|null} input.classifiedJobs non-successful signal jobs from
 *   `classifyRunJobs`; `null` means the state could not be determined at all
 * @param {boolean} [input.releaseCandidate] RC cuts are not `--latest` and announce to nobody
 * @param {boolean} [input.skipGate] audited escape hatch
 * @param {string} [input.skipReason] operator-supplied justification for the hatch
 * @returns {{publish: boolean, reason: string, headline: string, detail: string, blockingJobs: Array<object>}}
 */
export function decideReleaseGate({
  releaseSha,
  verifiedSha,
  expectedJobCount,
  observedJobCount,
  classifiedJobs,
  releaseCandidate = false,
  skipGate = false,
  skipReason = ''
}) {
  if (skipGate) {
    const justification = skipReason.trim()
    // An unrecorded skip is not an audited one, which is the only thing that makes
    // the hatch acceptable at all.
    if (!justification) {
      return {
        publish: false,
        reason: RELEASE_GATE_REASON.SKIP_UNJUSTIFIED,
        headline: 'the gate was skipped without a recorded reason — refusing to publish',
        detail: 'skip_gate requires skip_gate_reason so the release notes can carry it',
        blockingJobs: []
      }
    }
    return {
      publish: true,
      reason: RELEASE_GATE_REASON.SKIPPED,
      headline: 'the test signal gate was skipped by explicit operator request',
      detail: `skip_gate was set for this run; justification: ${justification}`,
      blockingJobs: []
    }
  }

  const release = normalizeSha(releaseSha)
  const verified = normalizeSha(verifiedSha)
  if (!release || !verified) {
    return indeterminate(
      `a release commit and a verified commit are both required (release: ${releaseSha ?? 'none'}, verified: ${verifiedSha ?? 'none'})`
    )
  }
  // The claim is about one tree; a signal from any other commit does not make it.
  if (release !== verified) {
    return indeterminate(`the signal ran against ${verified}, but the release builds ${release}`)
  }
  if (classifiedJobs === null || classifiedJobs === undefined) {
    return indeterminate('the jobs API returned no readable answer for this run')
  }
  if (!Number.isInteger(expectedJobCount) || expectedJobCount <= 0) {
    return indeterminate(`the workflow declared no signal jobs to wait for (${expectedJobCount})`)
  }
  // A missing job reports nothing at all, so absence has to be counted, not observed.
  if (observedJobCount !== expectedJobCount) {
    return indeterminate(
      `${observedJobCount} of ${expectedJobCount} signal jobs reported back — the suite did not run in full`
    )
  }

  if (classifiedJobs.length === 0) {
    return {
      publish: true,
      reason: RELEASE_GATE_REASON.GREEN,
      headline: `all ${expectedJobCount} signal jobs passed against ${verified}`,
      detail: '',
      blockingJobs: []
    }
  }

  const blockingJobs = releaseCandidate
    ? classifiedJobs.filter((job) => !RELEASE_CANDIDATE_TOLERATED_CLASSES.has(job.failureClass))
    : classifiedJobs

  if (blockingJobs.length === 0) {
    return {
      publish: true,
      reason: RELEASE_GATE_REASON.INFRA_ONLY,
      headline: `release candidate proceeding: no test failed, ${classifiedJobs.length} job(s) were cut short by infrastructure`,
      detail: describeJobs(classifiedJobs).join('; '),
      blockingJobs: []
    }
  }

  const codeFailures = blockingJobs.filter((job) => job.triage === 'code')
  const headline =
    codeFailures.length > 0
      ? `${codeFailures.length} signal job(s) failed a test against ${verified}`
      : `${blockingJobs.length} signal job(s) did not report a pass against ${verified}`
  return {
    publish: false,
    reason: RELEASE_GATE_REASON.RED,
    headline: `${headline} — refusing to publish`,
    detail: describeJobs(blockingJobs).join('; '),
    blockingJobs
  }
}

export function renderReleaseGateSummary(decision, { releaseSha, releaseCandidate }) {
  const lane = releaseCandidate ? 'release candidate' : 'latest'
  const verdict = decision.publish ? 'PUBLISH' : 'BLOCKED'
  const lines = [
    '## Release signal gate',
    '',
    `**${verdict}** — ${decision.headline}`,
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| Lane | ${lane} |`,
    `| Release commit | \`${releaseSha ?? 'unresolved'}\` |`,
    `| Reason | \`${decision.reason}\` |`,
    ''
  ]
  if (decision.detail) {
    lines.push(decision.detail, '')
  }
  if (decision.blockingJobs.length > 0) {
    lines.push(
      '| Job | Class | Triage |',
      '| --- | --- | --- |',
      ...decision.blockingJobs.map(
        (job) => `| ${job.name} | \`${job.failureClass}\` | ${job.triage} |`
      ),
      '',
      'What each class means: `docs/reference/ci-failure-classification.md`.',
      ''
    )
  }
  return lines.join('\n')
}
