#!/usr/bin/env node
/**
 * CLI wrapper: turns a captured GitHub Actions run into a publish/block verdict
 * for a lab release, writes it to the job summary and to GITHUB_OUTPUT, and exits
 * non-zero when the release must not publish.
 *
 * Usage:
 *   node config/scripts/decide-release-signal-gate.mjs --run run.json --jobs jobs.json \
 *     --release-sha <sha> --verified-sha <sha> --signal-job <jobKey>... --expected-jobs <n> \
 *     [--job-log-dir dir] [--release-candidate] [--skip-gate] [--skip-reason text]
 */

import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { classifyRunJobs } from './ci-failure-class.mjs'
import {
  collectWorkflowJobDefinitions,
  createJobDefinitionResolver
} from './ci-workflow-job-definitions.mjs'
import { decideReleaseGate, renderReleaseGateSummary } from './release-signal-gate.mjs'

const VALUE_FLAGS = {
  run: 'run',
  jobs: 'jobs',
  workflows: 'workflows',
  summary: 'summary',
  output: 'output',
  'job-log-dir': 'jobLogDir',
  'release-sha': 'releaseSha',
  'verified-sha': 'verifiedSha',
  'expected-jobs': 'expectedJobs',
  'skip-reason': 'skipReason'
}
const BOOLEAN_FLAGS = { 'release-candidate': 'releaseCandidate', 'skip-gate': 'skipGate' }

function parseArgs(argv) {
  const options = {
    workflows: '.github/workflows',
    summary: process.env.GITHUB_STEP_SUMMARY,
    output: process.env.GITHUB_OUTPUT,
    signalJobKeys: [],
    releaseCandidate: false,
    skipGate: false,
    skipReason: ''
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!flag.startsWith('--')) {
      throw new Error(`Unexpected argument: ${flag}`)
    }
    const key = flag.slice(2)
    if (key in BOOLEAN_FLAGS) {
      options[BOOLEAN_FLAGS[key]] = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined) {
      throw new Error(`Missing value for ${flag}`)
    }
    if (key === 'signal-job') {
      options.signalJobKeys.push(value)
    } else if (key in VALUE_FLAGS) {
      options[VALUE_FLAGS[key]] = value
    } else {
      throw new Error(`Unknown flag: ${flag}`)
    }
    index += 1
  }
  if (options.signalJobKeys.length === 0) {
    throw new Error('At least one --signal-job is required')
  }
  return options
}

/** Missing is normal: logs are captured only for jobs that failed. */
function readJobLog(dir, jobId) {
  try {
    return readFileSync(join(dir, `${jobId}.txt`), 'utf8')
  } catch {
    return null
  }
}

/**
 * Returns null when the run cannot be read at all — a torn or missing payload is
 * an unknown state, never an empty list of failures.
 */
function classifySignalJobs(options) {
  let run
  let jobs
  try {
    run = JSON.parse(readFileSync(options.run, 'utf8'))
    const payload = JSON.parse(readFileSync(options.jobs, 'utf8'))
    jobs = Array.isArray(payload) ? payload : payload.jobs
  } catch (error) {
    process.stderr.write(`Could not read the captured run: ${error.message}\n`)
    return null
  }
  if (!Array.isArray(jobs)) {
    process.stderr.write('The captured run carried no jobs array\n')
    return null
  }
  const resolveJobDefinition = createJobDefinitionResolver(
    collectWorkflowJobDefinitions(options.workflows)
  )
  const wanted = new Set(options.signalJobKeys)
  const signalJobs = jobs.filter((job) => wanted.has(resolveJobDefinition(job.name)?.jobKey))
  const classified = classifyRunJobs({
    run,
    jobs: signalJobs,
    resolveJobDefinition,
    readJobLog: options.jobLogDir ? (job) => readJobLog(options.jobLogDir, job.id) : null
  })
  return { observedJobCount: signalJobs.length, classified }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  // The gate is skipped without touching the API, so a broken API cannot also
  // break the escape hatch that exists for exactly that case.
  const signal = options.skipGate ? null : classifySignalJobs(options)
  const decision = decideReleaseGate({
    releaseSha: options.releaseSha ?? null,
    verifiedSha: options.verifiedSha ?? null,
    expectedJobCount: Number.parseInt(options.expectedJobs ?? '', 10),
    observedJobCount: signal?.observedJobCount ?? 0,
    classifiedJobs: signal?.classified ?? null,
    releaseCandidate: options.releaseCandidate,
    skipGate: options.skipGate,
    skipReason: options.skipReason
  })

  const summary = renderReleaseGateSummary(decision, {
    releaseSha: options.releaseSha ?? null,
    releaseCandidate: options.releaseCandidate
  })
  if (options.summary) {
    appendFileSync(options.summary, `${summary}\n`)
  }
  process.stdout.write(`${summary}\n`)
  if (options.output) {
    // A newline in a value would forge a second output key.
    const headline = decision.headline.replaceAll(/\s+/g, ' ')
    appendFileSync(
      options.output,
      `decision=${decision.publish ? 'publish' : 'block'}\nreason=${decision.reason}\nheadline=${headline}\n`
    )
  }
  if (!decision.publish) {
    process.stderr.write(`::error title=Release signal gate::${decision.headline}\n`)
    process.exitCode = 1
  }
}

main()
