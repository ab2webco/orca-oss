import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { CI_FAILURE_CLASS, classifyRunJobs } from './ci-failure-class.mjs'
import { renderAnnotations, renderJobSummary } from './ci-failure-class-report.mjs'
import {
  buildJobNamePattern,
  collectWorkflowJobDefinitions,
  createJobDefinitionResolver
} from './ci-workflow-job-definitions.mjs'

const FIXTURE_DIR = 'config/scripts/fixtures/ci-failure-class'

function loadRun(runId) {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}/run-${runId}.json`, 'utf8'))
}

// The caps that were in the workflows at each fixture's head SHA. Today's
// e2e cap is 45 (#91) and the matrix is 12 shards (#92), so classifying a
// historical run against the current YAML would be wrong by construction.
const HISTORICAL_DEFINITIONS = [
  ['e2e.yml', 'build', 'build e2e app', 10],
  ['e2e.yml', 'e2e', 'e2e ${{ matrix.shard_name }}', 30],
  ['e2e.yml', 'changed-e2e', 'changed e2e specs', 30],
  ['e2e.yml', 'ssh-docker-watcher-isolation', 'ssh docker watcher isolation', 35],
  [
    'pr.yml',
    'test',
    'tests node ${{ matrix.node }} ${{ matrix.shard }}/${{ matrix.shard_total }}',
    15
  ]
].map(([workflowFile, jobKey, declaredName, timeoutMinutes]) => ({
  workflowFile,
  jobKey,
  declaredName,
  namePattern: buildJobNamePattern(declaredName),
  timeoutMinutes
}))

const resolveHistorical = createJobDefinitionResolver(HISTORICAL_DEFINITIONS)

function classify(fixture, resolveJobDefinition = resolveHistorical) {
  return classifyRunJobs({ run: fixture.run, jobs: fixture.jobs, resolveJobDefinition })
}

function entryFor(classified, jobName) {
  const entry = classified.find((candidate) => candidate.name === jobName)
  if (!entry) {
    throw new Error(`No classification for job "${jobName}"`)
  }
  return entry
}

function replaceJob(fixture, jobName, patch) {
  return {
    ...fixture,
    jobs: fixture.jobs.map((job) => (job.name === jobName ? { ...job, ...patch } : job))
  }
}

describe('CI failure classification against recorded runs', () => {
  it('keeps every fixture cap in step with the caps the classifier is fed', () => {
    for (const runId of ['31657594303', '31654278963', '31663317660']) {
      const recorded = loadRun(runId).meta.jobTimeoutMinutesAtHeadSha
      const fromTable = Object.fromEntries(
        HISTORICAL_DEFINITIONS.map((definition) => [
          `${definition.workflowFile}#${definition.jobKey}`,
          definition.timeoutMinutes
        ])
      )
      expect(fromTable).toEqual(recorded)
    }
  })

  // run 31657594303: the night this ticket was opened. One shard hit the 30m cap
  // and three others failed real assertions, all in the same run.
  describe('run 31657594303 — a timeout and real test failures side by side', () => {
    const classified = classify(loadRun('31657594303'))

    it('classifies the shard that hit its cap as a timeout, not a failure', () => {
      const entry = entryFor(classified, 'e2e (full) / e2e 7-of-10')
      expect(entry.failureClass).toBe(CI_FAILURE_CLASS.TIMEOUT)
      expect(entry.triage).toBe('budget')
      expect(entry.conclusion).toBe('cancelled')
      expect(entry.durationSeconds).toBeGreaterThanOrEqual(30 * 60)
      expect(entry.evidence).toContain('30-minute cap')
    })

    it('classifies the shards that failed an assertion as test failures, naming the step', () => {
      for (const shard of ['2-of-10', '4-of-10', '5-of-10']) {
        const entry = entryFor(classified, `e2e (full) / e2e ${shard}`)
        expect(entry.failureClass).toBe(CI_FAILURE_CLASS.TESTS_FAILED)
        expect(entry.triage).toBe('code')
        expect(entry.step).toBe(`Run E2E tests (${shard})`)
      }
    })

    it('classifies the path-filtered job as skipped rather than failed', () => {
      const entry = entryFor(classified, 'e2e (full) / changed e2e specs')
      expect(entry.failureClass).toBe(CI_FAILURE_CLASS.DEPENDENCY_SKIPPED)
      expect(entry.triage).toBe('none')
    })

    it('leaves every successful job out of the report', () => {
      expect(classified.map((entry) => entry.name).sort()).toEqual([
        'e2e (full) / changed e2e specs',
        'e2e (full) / e2e 2-of-10',
        'e2e (full) / e2e 4-of-10',
        'e2e (full) / e2e 5-of-10',
        'e2e (full) / e2e 7-of-10'
      ])
    })
  })

  // run 31654278963: `Install Electron package binary for tests` failed and
  // `Test shard` never ran, yet the check read the same as a red test.
  describe('run 31654278963 — a setup step failed before the tests ran', () => {
    const classified = classify(loadRun('31654278963'))

    it('names the step that failed and says the work never ran', () => {
      const entry = entryFor(classified, 'tests node 24 11/16')
      expect(entry.failureClass).toBe(CI_FAILURE_CLASS.SETUP_FAILED)
      expect(entry.triage).toBe('setup')
      expect(entry.step).toBe('Install Electron package binary for tests')
      expect(entry.evidence).toContain('later steps were skipped')
    })

    it('does not read the skipped test step as a test failure', () => {
      const entry = entryFor(classified, 'tests node 24 11/16')
      expect(entry.failureClass).not.toBe(CI_FAILURE_CLASS.TESTS_FAILED)
    })
  })

  // run 31663317660: a superseding push cancelled the run; every shard went red
  // in the checks UI without a single test failing.
  describe('run 31663317660 — the whole run was cancelled', () => {
    const classified = classify(loadRun('31663317660'))

    it('reports every cancelled shard as not-a-failure', () => {
      const shards = classified.filter((entry) => entry.name.startsWith('e2e (full) / e2e '))
      expect(shards).toHaveLength(10)
      for (const shard of shards) {
        expect(shard.failureClass).toBe(CI_FAILURE_CLASS.CANCELLED_BY_RUN)
        expect(shard.triage).toBe('none')
      }
    })
  })
})

describe('the classification that must never be wrong', () => {
  const fixture = loadRun('31657594303')

  it('never calls a job that reported `failure` a timeout, however long it ran', () => {
    // Same real payload as shard 2-of-10, stretched past the 30m cap. Duration
    // alone must not flip a red test into "ran out of time" — that is the failure
    // this change would be dangerous for.
    const stretched = replaceJob(fixture, 'e2e (full) / e2e 2-of-10', {
      completed_at: '2026-08-13T02:05:00Z'
    })
    const entry = entryFor(classify(stretched), 'e2e (full) / e2e 2-of-10')
    expect(entry.durationSeconds).toBeGreaterThan(30 * 60)
    expect(entry.failureClass).toBe(CI_FAILURE_CLASS.TESTS_FAILED)
    expect(entry.triage).toBe('code')
  })

  it('does not call a cancelled job a timeout when it stopped short of its cap', () => {
    const early = replaceJob(fixture, 'e2e (full) / e2e 7-of-10', {
      completed_at: '2026-08-13T01:40:00Z'
    })
    const entry = entryFor(classify(early), 'e2e (full) / e2e 7-of-10')
    expect(entry.failureClass).not.toBe(CI_FAILURE_CLASS.TIMEOUT)
  })

  it('refuses to guess a timeout when no cap can be resolved for the job', () => {
    const entry = entryFor(
      classify(fixture, () => null),
      'e2e (full) / e2e 7-of-10'
    )
    expect(entry.failureClass).toBe(CI_FAILURE_CLASS.UNCLASSIFIED)
    expect(entry.triage).toBe('unknown')
    expect(entry.evidence).toContain('no timeout-minutes could be resolved')
  })
})

describe('a shard cancelled by another shard failing', () => {
  // No matrix in this repo runs with fail-fast enabled today, so there is no
  // recorded run of this shape. Derived from the real 7-of-10 payload: same job,
  // cancelled 12s after sibling 2-of-10 reported `failure` and well short of the
  // 30m cap — the trace GitHub leaves when fail-fast cancels a sibling.
  const fixture = replaceJob(loadRun('31657594303'), 'e2e (full) / e2e 7-of-10', {
    completed_at: '2026-08-13T01:50:47Z'
  })
  const entry = entryFor(classify(fixture), 'e2e (full) / e2e 7-of-10')

  it('is reported as cancelled by fail-fast, not as failed', () => {
    expect(entry.failureClass).toBe(CI_FAILURE_CLASS.CANCELLED_BY_FAIL_FAST)
    expect(entry.triage).toBe('none')
    expect(entry.evidence).toContain('e2e (full) / e2e 2-of-10')
  })

  it('is not attributed to fail-fast when no sibling failed near its end', () => {
    const noSiblingFailure = {
      ...fixture,
      jobs: fixture.jobs.map((job) =>
        job.conclusion === 'failure' ? { ...job, conclusion: 'success', steps: [] } : job
      )
    }
    const alone = entryFor(classify(noSiblingFailure), 'e2e (full) / e2e 7-of-10')
    expect(alone.failureClass).toBe(CI_FAILURE_CLASS.UNCLASSIFIED)
  })
})

describe('resolving a job name back to its workflow definition', () => {
  const resolve = createJobDefinitionResolver(collectWorkflowJobDefinitions('.github/workflows'))

  it('resolves a sharded unit-test job through its matrix name', () => {
    const definition = resolve('tests node 24 11/16')
    expect(definition).toMatchObject({ workflowFile: 'pr.yml', jobKey: 'test' })
    expect(definition.timeoutMinutes).toBeGreaterThan(0)
  })

  it('resolves a reusable-workflow job through its `caller / job` name', () => {
    const definition = resolve('e2e (full) / e2e 7-of-12')
    expect(definition).toMatchObject({ workflowFile: 'e2e.yml', jobKey: 'e2e' })
    expect(definition.timeoutMinutes).toBeGreaterThan(0)
  })

  it('does not let a caller prefix drag a job into a sibling job’s wildcard name', () => {
    // `e2e ${{ matrix.shard_name }}` matches the whole of
    // `e2e (full) / changed e2e specs` if the caller prefix is not stripped first.
    const definition = resolve('e2e (full) / changed e2e specs')
    expect(definition).toMatchObject({ workflowFile: 'e2e.yml', jobKey: 'changed-e2e' })
  })

  it('groups matrix siblings under one definition', () => {
    expect(resolve('tests node 24 1/16').jobKey).toBe(resolve('tests node 24 16/16').jobKey)
  })

  it('returns null for a job name no workflow declares', () => {
    expect(resolve('a job that does not exist')).toBeNull()
  })

  it('reports no cap for a job that declares none', () => {
    expect(resolve('verify')?.timeoutMinutes ?? null).toBeNull()
  })

  it('refuses to pick a winner when two declared names both match', () => {
    const define = (workflowFile, jobKey, declaredName, timeoutMinutes) => ({
      workflowFile,
      jobKey,
      declaredName,
      namePattern: buildJobNamePattern(declaredName),
      timeoutMinutes
    })
    const ambiguous = createJobDefinitionResolver([
      define('a.yml', 'one', 'shard ${{ matrix.n }}', 10),
      define('b.yml', 'two', 'shard 3', 40)
    ])
    expect(ambiguous('shard 3')).toBeNull()
    expect(ambiguous('shard 4')).toMatchObject({ workflowFile: 'a.yml', timeoutMinutes: 10 })
  })
})

describe('the surfaces a reader sees without opening a log', () => {
  const classified = classify(loadRun('31657594303'))

  it('puts real failures above budget and cancellation classes in the summary', () => {
    const summary = renderJobSummary(classified)
    expect(summary.indexOf('`tests-failed`')).toBeLessThan(summary.indexOf('`timeout`'))
    expect(summary).toContain('3 job(s) failed on their own account')
  })

  it('names the class and the evidence for every job in the summary table', () => {
    const summary = renderJobSummary(classified)
    expect(summary).toContain('e2e (full) / e2e 7-of-10')
    expect(summary).toContain('ran out of time — no test failed')
    expect(summary).toContain('Run E2E tests (2-of-10)')
  })

  it('annotates real failures louder than budget classes', () => {
    const annotations = renderAnnotations(classified)
    expect(annotations).toContain(
      '::notice title=timeout: e2e (full) / e2e 7-of-10::job conclusion "cancelled" after 30m17s against its 30-minute cap'
    )
    expect(
      annotations.some((line) =>
        line.startsWith('::warning title=tests-failed: e2e (full) / e2e 2-of-10::')
      )
    ).toBe(true)
  })

  it('says so plainly when nothing in the run failed', () => {
    expect(renderJobSummary([])).toContain('Every job in this run succeeded.')
  })
})
