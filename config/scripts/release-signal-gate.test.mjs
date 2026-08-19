import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { CI_FAILURE_CLASS } from './ci-failure-class.mjs'
import { decideReleaseGate, RELEASE_GATE_REASON } from './release-signal-gate.mjs'

const SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)

function classified(failureClass, triage, name = 'release gate tests 7/16') {
  return { id: 1, name, failureClass, triage, evidence: 'recorded evidence' }
}

function gateInput(overrides = {}) {
  return {
    releaseSha: SHA,
    verifiedSha: SHA,
    expectedJobCount: 17,
    observedJobCount: 17,
    classifiedJobs: [],
    ...overrides
  }
}

describe('decideReleaseGate on the --latest lane', () => {
  it('publishes when every signal job passed against the released commit', () => {
    const decision = decideReleaseGate(gateInput())
    expect(decision.publish).toBe(true)
    expect(decision.reason).toBe(RELEASE_GATE_REASON.GREEN)
  })

  it('refuses and names the failure when a test went red', () => {
    const decision = decideReleaseGate(
      gateInput({ classifiedJobs: [classified(CI_FAILURE_CLASS.TESTS_FAILED, 'code')] })
    )
    expect(decision.publish).toBe(false)
    expect(decision.reason).toBe(RELEASE_GATE_REASON.RED)
    expect(decision.headline).toContain('failed a test')
    expect(decision.detail).toContain('release gate tests 7/16')
  })

  // The trap: a wedged shard asserts nothing, so it cannot be read as a pass.
  // Tolerating it here would let any infra hiccup disarm the gate silently.
  it.each([
    [CI_FAILURE_CLASS.HANG, 'budget'],
    [CI_FAILURE_CLASS.TIMEOUT, 'budget'],
    [CI_FAILURE_CLASS.SETUP_FAILED, 'setup'],
    [CI_FAILURE_CLASS.DEPENDENCY_SKIPPED, 'none'],
    [CI_FAILURE_CLASS.UNCLASSIFIED, 'unknown']
  ])('refuses on a %s job even though no test failed', (failureClass, triage) => {
    const decision = decideReleaseGate(
      gateInput({ classifiedJobs: [classified(failureClass, triage)] })
    )
    expect(decision.publish).toBe(false)
    expect(decision.reason).toBe(RELEASE_GATE_REASON.RED)
  })

  it('says a non-test class did not report a pass rather than claiming a red test', () => {
    const decision = decideReleaseGate(
      gateInput({ classifiedJobs: [classified(CI_FAILURE_CLASS.HANG, 'budget')] })
    )
    expect(decision.headline).toContain('did not report a pass')
    expect(decision.headline).not.toContain('failed a test')
  })
})

describe('decideReleaseGate on the release-candidate lane', () => {
  const rc = (classifiedJobs) =>
    decideReleaseGate(gateInput({ classifiedJobs, releaseCandidate: true }))

  it.each([
    CI_FAILURE_CLASS.HANG,
    CI_FAILURE_CLASS.TIMEOUT,
    CI_FAILURE_CLASS.CANCELLED_BY_FAIL_FAST
  ])(
    'proceeds through %s and records it, because an RC is not Latest and announces to nobody',
    (failureClass) => {
      const decision = rc([classified(failureClass, 'budget')])
      expect(decision.publish).toBe(true)
      expect(decision.reason).toBe(RELEASE_GATE_REASON.INFRA_ONLY)
      expect(decision.detail).toContain(failureClass)
    }
  )

  it('still refuses on a red test', () => {
    const decision = rc([classified(CI_FAILURE_CLASS.TESTS_FAILED, 'code')])
    expect(decision.publish).toBe(false)
    expect(decision.reason).toBe(RELEASE_GATE_REASON.RED)
  })

  it('still refuses on a shard that never ran — that is unproven, not infrastructure', () => {
    const decision = rc([classified(CI_FAILURE_CLASS.DEPENDENCY_SKIPPED, 'none')])
    expect(decision.publish).toBe(false)
  })

  it('refuses when one shard hung and another failed a test', () => {
    const decision = rc([
      classified(CI_FAILURE_CLASS.HANG, 'budget', 'release gate tests 2/16'),
      classified(CI_FAILURE_CLASS.TESTS_FAILED, 'code', 'release gate tests 9/16')
    ])
    expect(decision.publish).toBe(false)
    expect(decision.blockingJobs).toHaveLength(1)
    expect(decision.blockingJobs[0].name).toBe('release gate tests 9/16')
  })
})

describe('decideReleaseGate when the signal cannot be determined', () => {
  it.each([
    ['the jobs API answer is unreadable', { classifiedJobs: null }],
    ['no commit was resolved', { releaseSha: null }],
    ['the signal ran against another commit', { verifiedSha: OTHER_SHA }],
    ['a signal job never reported back', { observedJobCount: 16 }],
    ['the workflow declared no signal jobs', { expectedJobCount: 0 }]
  ])('refuses to publish when %s', (_label, overrides) => {
    const decision = decideReleaseGate(gateInput(overrides))
    expect(decision.publish).toBe(false)
    expect(decision.reason).toBe(RELEASE_GATE_REASON.INDETERMINATE)
  })
})

describe('the escape hatch', () => {
  it('publishes a red signal only when a reason is recorded', () => {
    const red = { classifiedJobs: [classified(CI_FAILURE_CLASS.TESTS_FAILED, 'code')] }
    expect(decideReleaseGate(gateInput(red)).publish).toBe(false)

    // The control for every "the gate blocked it" case above: the same red input
    // with the gate lifted publishes, so the gate is what stops it.
    const skipped = decideReleaseGate(
      gateInput({ ...red, skipGate: true, skipReason: 'GitHub Actions incident' })
    )
    expect(skipped.publish).toBe(true)
    expect(skipped.reason).toBe(RELEASE_GATE_REASON.SKIPPED)
    expect(skipped.detail).toContain('GitHub Actions incident')
  })

  it('refuses an unjustified skip, so the hatch is auditable by construction', () => {
    const decision = decideReleaseGate(gateInput({ skipGate: true, skipReason: '   ' }))
    expect(decision.publish).toBe(false)
    expect(decision.reason).toBe(RELEASE_GATE_REASON.SKIP_UNJUSTIFIED)
  })

  it('does not need the API, which is the outage the hatch exists for', () => {
    const decision = decideReleaseGate(
      gateInput({ classifiedJobs: null, verifiedSha: null, skipGate: true, skipReason: 'API down' })
    )
    expect(decision.publish).toBe(true)
  })
})

// End-to-end through the CLI: the exit code is what actually stops a release.
describe('decide-release-signal-gate.mjs', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'release-gate-'))
  afterAll(() => rmSync(workspace, { recursive: true, force: true }))

  const successStep = { name: 'Test shard', conclusion: 'success' }
  const failedStep = { name: 'Test shard', conclusion: 'failure' }

  function job(name, overrides = {}) {
    return {
      id: Math.floor(Math.random() * 1e9),
      name,
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-08-18T10:00:00Z',
      completed_at: '2026-08-18T10:03:00Z',
      html_url: 'https://example.invalid/job',
      steps: [{ name: 'Set up job', conclusion: 'success' }, successStep],
      ...overrides
    }
  }

  function signalJobs() {
    return [
      job('release gate static analysis'),
      ...Array.from({ length: 16 }, (_, index) => job(`release gate tests ${index + 1}/16`))
    ]
  }

  function runGate(jobs, { runConclusion = 'success', extraArgs = [], writeJobs = true } = {}) {
    const label = `case-${Math.random().toString(36).slice(2)}`
    const runPath = join(workspace, `${label}-run.json`)
    const jobsPath = join(workspace, `${label}-jobs.json`)
    const summaryPath = join(workspace, `${label}-summary.md`)
    const outputPath = join(workspace, `${label}-output.txt`)
    writeFileSync(runPath, JSON.stringify({ conclusion: runConclusion }))
    if (writeJobs) {
      writeFileSync(jobsPath, JSON.stringify({ jobs }))
    }
    writeFileSync(summaryPath, '')
    writeFileSync(outputPath, '')
    let status = 0
    try {
      execFileSync(
        process.execPath,
        [
          'config/scripts/decide-release-signal-gate.mjs',
          '--run',
          runPath,
          '--jobs',
          jobsPath,
          '--release-sha',
          SHA,
          '--verified-sha',
          SHA,
          '--signal-job',
          'gate_static',
          '--signal-job',
          'gate_tests',
          '--expected-jobs',
          '17',
          ...extraArgs
        ],
        {
          stdio: 'pipe',
          env: {
            ...process.env,
            GITHUB_STEP_SUMMARY: summaryPath,
            GITHUB_OUTPUT: outputPath
          }
        }
      )
    } catch (error) {
      status = error.status ?? 1
    }
    return {
      status,
      summary: readFileSync(summaryPath, 'utf8'),
      output: readFileSync(outputPath, 'utf8')
    }
  }

  it('exits 0 and reports PUBLISH when all 17 signal jobs passed', () => {
    const result = runGate(signalJobs())
    expect(result.status).toBe(0)
    expect(result.summary).toContain('**PUBLISH**')
    expect(result.output).toContain('decision=publish')
  })

  it('exits 1 and names the shard when one failed a test', () => {
    const jobs = signalJobs()
    jobs[5] = job('release gate tests 5/16', {
      conclusion: 'failure',
      steps: [{ name: 'Set up job', conclusion: 'success' }, failedStep]
    })
    const result = runGate(jobs)
    expect(result.status).toBe(1)
    expect(result.summary).toContain('**BLOCKED**')
    expect(result.summary).toContain('release gate tests 5/16')
    expect(result.summary).toContain('tests-failed')
    expect(result.output).toContain('decision=block')
  })

  // The measured trap: a PR Checks run is `failure` whenever the non-blocking e2e
  // lane is red, so the verdict must read the gate's own jobs, not the run.
  it('publishes when a job outside the signal failed and every signal job passed', () => {
    const result = runGate([...signalJobs(), job('mac', { conclusion: 'failure' })], {
      runConclusion: 'failure'
    })
    expect(result.status).toBe(0)
    expect(result.summary).toContain('**PUBLISH**')
  })

  it('exits 1 when a signal job is missing from the API answer', () => {
    const result = runGate(signalJobs().slice(0, 16))
    expect(result.status).toBe(1)
    expect(result.summary).toContain('signal-indeterminate')
  })

  it('exits 1 when the jobs payload cannot be read at all', () => {
    const result = runGate(signalJobs(), { writeJobs: false })
    expect(result.status).toBe(1)
    expect(result.summary).toContain('signal-indeterminate')
  })

  it('exits 0 on the same red signal once the gate is explicitly skipped', () => {
    const jobs = signalJobs()
    jobs[5] = job('release gate tests 5/16', {
      conclusion: 'failure',
      steps: [{ name: 'Set up job', conclusion: 'success' }, failedStep]
    })
    expect(runGate(jobs).status).toBe(1)
    const skipped = runGate(jobs, {
      extraArgs: ['--skip-gate', '--skip-reason', 'Actions incident 2026-08-18']
    })
    expect(skipped.status).toBe(0)
    expect(skipped.summary).toContain('Actions incident 2026-08-18')
  })
})
