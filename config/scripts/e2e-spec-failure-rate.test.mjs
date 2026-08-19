import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderReport } from './e2e-failure-rate-report.mjs'
import { aggregateReports, parseReport, TEST_OUTCOME } from './e2e-spec-failure-rate.mjs'
import { summarizeCensus } from './e2e-unrun-test-census.mjs'

// Real Playwright reports, produced by running the Orca E2E suite with one
// assertion inverted in `orca-profiles.spec.ts` (attempt 1) and clean (attempt 2).
const FIXTURES = path.join(import.meta.dirname, '__fixtures__')

/** @param {string} name */
function loadFixture(name) {
  const parsed = JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'))
  return parseReport(parsed, `${name}.json`)
}

const runAFailed = loadFixture('e2e-report-run-a-attempt-1')
const runARerun = loadFixture('e2e-report-run-a-attempt-2')
const runBClean = loadFixture('e2e-report-run-b-attempt-1')
const shardOne = loadFixture('e2e-report-shard-1-of-2')
const shardTwo = loadFixture('e2e-report-shard-2-of-2')

const PROFILES_SPEC = 'orca-profiles.spec.ts'
const DAEMON_SPEC = 'daemon-generation-reconnect-safety.spec.ts'
const FIXME_SPEC = 'tab-create-entry-file-paths.spec.ts'

/** @param {ReturnType<typeof aggregateReports>} aggregate @param {string} file */
function specsOf(aggregate, file) {
  return aggregate.specs.filter((entry) => entry.file === file)
}

describe('parseReport', () => {
  it('reads every outcome the report carries', () => {
    const byFile = Object.fromEntries(
      runAFailed.observations.map((observation) => [observation.file, observation])
    )
    expect(runAFailed.observations).toHaveLength(5)
    expect(byFile[PROFILES_SPEC].outcome).toBe(TEST_OUTCOME.FAILED)
    expect(byFile[PROFILES_SPEC].reason).toContain('toHaveCount')
    expect(byFile['markdown-explorer-find-focus.spec.ts'].outcome).toBe(TEST_OUTCOME.PASSED)
    expect(byFile[FIXME_SPEC].outcome).toBe(TEST_OUTCOME.FIXME)
    expect(byFile[DAEMON_SPEC].outcome).toBe(TEST_OUTCOME.SKIPPED)
    expect(byFile[DAEMON_SPEC].reason).toBe('Native Windows named pipes and ConPTY are required')
  })

  it('keeps the describe title in the spec identity', () => {
    const profiles = runAFailed.observations.find((entry) => entry.file === PROFILES_SPEC)
    expect(profiles?.title).toBe(
      'default single-profile mode › hides the account trigger when cloud is unconfigured'
    )
  })

  it('reads run and attempt from the report itself', () => {
    expect(runAFailed.runKey).toBe('32200000001#1')
    expect(runARerun.runKey).toBe('32200000001#2')
  })

  it('keeps a top-level suite title that is not the file in the identity', () => {
    const nested = parseReport(
      {
        config: { metadata: { orcaRunId: '1', orcaRunAttempt: '1' } },
        suites: [
          {
            title: 'remote',
            file: 'remote/paired.spec.ts',
            suites: [
              {
                title: 'remote/paired.spec.ts',
                file: 'remote/paired.spec.ts',
                specs: [
                  {
                    title: 'reconnects',
                    file: 'remote/paired.spec.ts',
                    line: 9,
                    tests: [{ status: 'expected', results: [{ status: 'passed' }] }]
                  }
                ]
              }
            ]
          }
        ]
      },
      'nested.json'
    )
    expect(nested.observations[0].title).toBe('remote › remote/paired.spec.ts › reconnects')
  })

  it('classifies an aborted result as interrupted, not as a failure', () => {
    const aborted = parseReport(
      {
        config: { metadata: { orcaRunId: '1', orcaRunAttempt: '1' } },
        suites: [
          {
            title: 'aborted.spec.ts',
            file: 'aborted.spec.ts',
            specs: [
              {
                title: 'never finished',
                file: 'aborted.spec.ts',
                line: 3,
                tests: [{ status: 'unexpected', results: [{ status: 'interrupted' }] }]
              }
            ]
          }
        ]
      },
      'aborted.json'
    )
    expect(aborted.observations[0].outcome).toBe(TEST_OUTCOME.INTERRUPTED)
  })
})

describe('aggregateReports', () => {
  it('counts one failure out of the runs the spec actually executed in', () => {
    const aggregate = aggregateReports([runAFailed, runARerun, runBClean])
    const [profiles] = specsOf(aggregate, PROFILES_SPEC)
    expect(profiles.executions).toBe(3)
    expect(profiles.failures).toBe(1)
    expect(profiles.failureRate).toBeCloseTo(1 / 3, 5)
    expect(profiles.failedIn).toEqual(['32200000001#1'])
    expect(aggregate.totals.failures).toBe(1)
  })

  it('reports zero for a harvest with no failure in it', () => {
    const aggregate = aggregateReports([runARerun, runBClean])
    expect(aggregate.totals.failures).toBe(0)
    expect(specsOf(aggregate, PROFILES_SPEC)[0].failureRate).toBe(0)
    expect(aggregate.totals.executions).toBe(4)
  })

  it('keeps a re-run attempt as its own observation', () => {
    const aggregate = aggregateReports([runAFailed, runARerun])
    expect(aggregate.runs.map((run) => run.runKey)).toEqual(['32200000001#1', '32200000001#2'])
    expect(specsOf(aggregate, PROFILES_SPEC)[0].executions).toBe(2)
  })

  it('leaves skipped and fixme tests out of the denominator', () => {
    const aggregate = aggregateReports([runAFailed, runARerun, runBClean])
    const daemon = specsOf(aggregate, DAEMON_SPEC)
    expect(daemon).toHaveLength(2)
    for (const entry of daemon) {
      expect(entry.executions).toBe(0)
      expect(entry.skipped).toBe(3)
      expect(entry.failureRate).toBeNull()
    }
    expect(specsOf(aggregate, FIXME_SPEC)[0].fixme).toBe(3)
    expect(aggregate.totals.neverExecuted).toBe(3)
  })

  it('names the shard that produced no report', () => {
    expect(aggregateReports([shardOne, shardTwo]).runs[0].missingShards).toEqual([])
    const withGap = aggregateReports([shardOne])
    expect(withGap.runs[0].missingShards).toEqual([2])
    expect(withGap.runs[0].shardsSeen).toEqual([1])
  })
})

describe('renderReport', () => {
  const census = summarizeCensus([])

  it('puts the failing spec, its rate and the missing shard in the output', () => {
    const markdown = renderReport(aggregateReports([runAFailed, runARerun, shardOne]), census, 40)
    expect(markdown).toContain('orca-profiles.spec.ts:16')
    expect(markdown).toContain('1/2')
    expect(markdown).toContain('50%')
    expect(markdown).toContain('| 32200000003#1 | 1/2 | 2 |')
  })

  it('says so when nothing failed instead of printing an empty table', () => {
    const markdown = renderReport(aggregateReports([runARerun, runBClean]), census, 40)
    expect(markdown).toContain('No spec failed in the harvested reports')
    expect(markdown).not.toContain('| Spec | Failed / executed |')
  })
})
