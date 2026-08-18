import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { CI_FAILURE_CLASS, CI_FAILURE_TRIAGE, classifyRunJobs } from './ci-failure-class.mjs'
import { detectVitestHangInLog } from './vitest-hang-marker.mjs'

// Real logs: the wedged run the watchdog killed here, and a real GitHub shard log
// (timestamp-prefixed) that never hung.
const HANG_LOG = readFileSync('config/scripts/__fixtures__/job-log-hang.txt', 'utf8')
const RED_TEST_LOG = readFileSync('config/scripts/__fixtures__/job-log-tests-failed.txt', 'utf8')

/** A job the jobs API reports exactly as a red test: `failure`, work step ran. */
function failedJob(overrides = {}) {
  return {
    id: 1,
    name: 'tests node 24 9/16',
    conclusion: 'failure',
    status: 'completed',
    started_at: '2026-08-18T19:00:00Z',
    completed_at: '2026-08-18T19:07:00Z',
    steps: [
      { name: 'Set up job', number: 1, conclusion: 'success' },
      { name: 'Test shard', number: 2, conclusion: 'failure' },
      { name: 'Complete job', number: 3, conclusion: 'success' }
    ],
    ...overrides
  }
}

function classify(readJobLog) {
  return classifyRunJobs({
    run: { conclusion: 'failure' },
    jobs: [failedJob()],
    resolveJobDefinition: () => ({ workflowFile: 'pr.yml', jobKey: 'test', timeoutMinutes: 15 }),
    ...(readJobLog ? { readJobLog } : {})
  })[0]
}

describe('detectVitestHangInLog', () => {
  it('reads the wedged module and silence out of a real watchdog block', () => {
    const detection = detectVitestHangInLog(HANG_LOG)
    expect(detection.hang).toBe(true)
    expect(detection.verdict).toBe('wedged-modules')
    expect(detection.module).toContain('terminal-history-incremental-restore.test.ts')
    expect(detection.phase).toBe('running')
    expect(detection.silenceSeconds).toBeGreaterThan(0)
  })

  it('does not fire on a real job log that never hung', () => {
    expect(detectVitestHangInLog(RED_TEST_LOG).hang).toBe(false)
  })

  // Any step can exit 124 for its own reasons; only the watchdog's marker means a hang.
  it('does not fire on exit code 124 without the marker', () => {
    expect(detectVitestHangInLog('##[error]Process completed with exit code 124.').hang).toBe(false)
  })

  it('tolerates GitHub timestamp prefixes on every line', () => {
    const prefixed = HANG_LOG.split('\n')
      .map((line) => `2026-08-18T19:07:00.1234567Z ${line}`)
      .join('\n')
    expect(detectVitestHangInLog(prefixed).module).toContain(
      'terminal-history-incremental-restore.test.ts'
    )
  })

  it('reports absence rather than throwing when there is no log', () => {
    expect(detectVitestHangInLog(null).hang).toBe(false)
    expect(detectVitestHangInLog('').hang).toBe(false)
  })
})

describe('classifyRunJobs with job logs', () => {
  it('separates a watchdog-killed job from a red test on identical API signals', () => {
    const hang = classify(() => HANG_LOG)
    const redTest = classify(() => RED_TEST_LOG)

    expect(hang.failureClass).toBe(CI_FAILURE_CLASS.HANG)
    expect(hang.triage).toBe('budget')
    expect(hang.wedgedModule).toContain('terminal-history-incremental-restore.test.ts')

    expect(redTest.failureClass).toBe(CI_FAILURE_CLASS.TESTS_FAILED)
    expect(redTest.triage).toBe('code')
  })

  // Without the log the two collapse — which is the ORCA-263 defect itself.
  it('falls back to tests-failed when no log reader is supplied', () => {
    expect(classify(null).failureClass).toBe(CI_FAILURE_CLASS.TESTS_FAILED)
  })

  it('keeps the API classification when the log cannot be read', () => {
    const thrown = classify(() => {
      throw new Error('log expired')
    })
    expect(thrown.failureClass).toBe(CI_FAILURE_CLASS.TESTS_FAILED)
    expect(classify(() => null).failureClass).toBe(CI_FAILURE_CLASS.TESTS_FAILED)
  })

  it('reads at most one log, and only for a job the API called tests-failed', () => {
    const asked = []
    const jobs = [
      failedJob(),
      failedJob({ id: 2, name: 'shard ok', conclusion: 'success' }),
      failedJob({
        id: 3,
        name: 'setup broke',
        steps: [
          { name: 'Install', number: 1, conclusion: 'failure' },
          { name: 'Test shard', number: 2, conclusion: 'skipped' }
        ]
      })
    ]
    classifyRunJobs({
      run: { conclusion: 'failure' },
      jobs,
      resolveJobDefinition: () => ({ workflowFile: 'pr.yml', jobKey: 'test', timeoutMinutes: 15 }),
      readJobLog: (job) => {
        asked.push(job.id)
        return RED_TEST_LOG
      }
    })
    expect(asked).toEqual([1])
  })

  it('routes the hang class to budget, never to code', () => {
    expect(CI_FAILURE_TRIAGE[CI_FAILURE_CLASS.HANG]).toBe('budget')
  })
})
