#!/usr/bin/env node
// Plans the full E2E suite's shards for e2e.yml's e2e job, and writes the GitHub matrix to
// $GITHUB_OUTPUT as `matrix=[{ shard_name, files }]`.
//
// Why not Playwright's --shard: it cuts the sorted list into runs of equal test count, so the
// one-test team-panel-* specs, about 40 minutes together, all fell in shard 8 of run 42563987741,
// which hit its 45-minute cap with 30 tests unrun (ORCA-1148).
//
// Refresh the measured durations from a full run's JSON reports:
//   gh run download <run id> -p 'e2e-json-report-*' -D <dir>
//   node config/scripts/split-e2e-suite-specs.mjs --refresh <dir> <run id>
import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  DURATIONS_FILE,
  balanceByWeight,
  measuredSecondsOf,
  readDurations
} from './split-changed-e2e-specs.mjs'

export { DURATIONS_FILE, readDurations }
export const SUITE_SHARDS = 12
const SPEC_DIR = 'tests/e2e'

export function listSpecs(dir = SPEC_DIR) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.spec.ts'))
    .map((file) => `${dir}/${file.split('\\').join('/')}`)
    .sort()
}

/**
 * Balances the suite by measured seconds; see measuredSecondsOf for specs the record lacks.
 * @param {string[]} files
 * @param {{ durations: Record<string, number>, sizeOf: (file: string) => number, total?: number }} options
 */
export function planSuiteShards(files, { durations, sizeOf, total = SUITE_SHARDS }) {
  const weightOf = measuredSecondsOf(files, { durations, sizeOf })
  return balanceByWeight(files, total, weightOf).map((shard, index) => ({
    shard_name: `${index + 1}-of-${total}`,
    files: JSON.stringify(shard.files),
    seconds: Math.round(shard.weight)
  }))
}

/** Sums each spec file's test durations over Playwright JSON reports, in whole seconds. */
export function durationsFromReports(reports) {
  const ms = {}
  const walk = (suite) => {
    for (const child of suite.suites ?? []) {
      walk(child)
    }
    for (const spec of suite.specs ?? []) {
      const file = `${SPEC_DIR}/${spec.file}`
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          ms[file] = (ms[file] ?? 0) + result.duration
        }
      }
    }
  }
  for (const report of reports) {
    for (const suite of report.suites ?? []) {
      walk(suite)
    }
  }
  return Object.fromEntries(
    Object.entries(ms).map(([file, total]) => [file, Math.round(total / 1000)])
  )
}

export function refreshDurations({ reportsDir, mapFile = DURATIONS_FILE, source }) {
  const reports = readdirSync(reportsDir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('e2e-report.json'))
    .map((file) => JSON.parse(readFileSync(join(reportsDir, file), 'utf8')))
  // Why merge: a cancelled shard uploads no report, so its specs keep their last figure.
  const merged = { ...readDurations(mapFile), ...durationsFromReports(reports) }
  const seconds = Object.fromEntries(
    Object.entries(merged)
      .filter(([file]) => existsSync(file))
      .sort(([a], [b]) => a.localeCompare(b))
  )
  writeFileSync(mapFile, `${JSON.stringify({ source, seconds }, null, 2)}\n`)
}

export function main({ output = process.env.GITHUB_OUTPUT, log = console.log } = {}) {
  const shards = planSuiteShards(listSpecs(), {
    durations: readDurations(),
    sizeOf: (file) => statSync(file).size
  })
  const matrix = shards.map(({ shard_name, files }) => ({ shard_name, files }))
  if (output) {
    appendFileSync(output, `matrix=${JSON.stringify(matrix)}\n`)
  }
  for (const shard of shards) {
    log(
      `e2e ${shard.shard_name}: ~${Math.round(shard.seconds / 60)} min, ${JSON.parse(shard.files).length} specs`
    )
  }
  return matrix
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [flag, reportsDir, runId] = process.argv.slice(2)
  if (flag === '--refresh') {
    refreshDurations({ reportsDir, source: `E2E run ${runId}` })
  } else {
    main()
  }
}
