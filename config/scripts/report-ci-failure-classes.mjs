#!/usr/bin/env node
/**
 * CLI wrapper: classifies a captured GitHub Actions run and writes the result to
 * the job summary plus workflow annotations. Takes payloads from disk so the
 * classification is reproducible off a saved run and needs no network here.
 *
 * Usage:
 *   node config/scripts/report-ci-failure-classes.mjs --run run.json --jobs jobs.json \
 *     [--gate-job <name>]... [--exclude-job <name>]...
 */

import { appendFileSync, readFileSync } from 'node:fs'

import { classifyRunJobs } from './ci-failure-class.mjs'
import { renderAnnotations, renderJobSummary } from './ci-failure-class-report.mjs'
import {
  collectWorkflowJobDefinitions,
  createJobDefinitionResolver
} from './ci-workflow-job-definitions.mjs'

const SINGLE_VALUE_FLAGS = ['run', 'jobs', 'workflows', 'summary']
const REPEATABLE_FLAGS = { 'gate-job': 'gateJobNames', 'exclude-job': 'excludedJobNames' }

function parseArgs(argv) {
  const options = {
    workflows: '.github/workflows',
    summary: process.env.GITHUB_STEP_SUMMARY,
    gateJobNames: [],
    excludedJobNames: []
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!flag.startsWith('--')) {
      throw new Error(`Unexpected argument: ${flag}`)
    }
    const key = flag.slice(2)
    if (!SINGLE_VALUE_FLAGS.includes(key) && !(key in REPEATABLE_FLAGS)) {
      throw new Error(`Unknown flag: ${flag}`)
    }
    const value = argv[index + 1]
    if (value === undefined) {
      throw new Error(`Missing value for ${flag}`)
    }
    if (key in REPEATABLE_FLAGS) {
      options[REPEATABLE_FLAGS[key]].push(value)
    } else {
      options[key] = value
    }
    index += 1
  }
  if (!options.run || !options.jobs) {
    throw new Error('Both --run and --jobs are required')
  }
  return options
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const run = readJson(options.run)
  const jobsPayload = readJson(options.jobs)
  const jobs = Array.isArray(jobsPayload) ? jobsPayload : (jobsPayload.jobs ?? [])

  const resolveJobDefinition = createJobDefinitionResolver(
    collectWorkflowJobDefinitions(options.workflows)
  )
  const classified = classifyRunJobs({
    run,
    jobs,
    resolveJobDefinition,
    gateJobNames: options.gateJobNames,
    excludedJobNames: options.excludedJobNames
  })

  for (const annotation of renderAnnotations(classified)) {
    process.stdout.write(`${annotation}\n`)
  }
  const summary = renderJobSummary(classified)
  if (options.summary) {
    appendFileSync(options.summary, `${summary}\n`)
  } else {
    process.stdout.write(`${summary}\n`)
  }
}

main()
