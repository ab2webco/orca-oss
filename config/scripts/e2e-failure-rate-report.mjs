#!/usr/bin/env node
/**
 * Reports the per-spec E2E failure rate from harvested Playwright JSON reports,
 * plus the population no rate can cover because it never executes.
 *
 * Harvest the artifacts first (one per shard per attempt, so a re-run does not
 * overwrite the attempt that failed):
 *   gh run download <run-id> --dir e2e-reports --pattern 'e2e-json-report-*'
 *   node config/scripts/e2e-failure-rate-report.mjs --reports e2e-reports
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { aggregateReports, formatRate, parseReport } from './e2e-spec-failure-rate.mjs'
import { censusSpecSource, summarizeCensus } from './e2e-unrun-test-census.mjs'

/** @param {string[]} argv */
export function parseArguments(argv) {
  const options = { reports: 'e2e-reports', testsDir: 'tests/e2e', json: null, out: null, top: 40 }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1]
    switch (argv[index]) {
      case '--reports':
        options.reports = String(value)
        index += 1
        break
      case '--tests-dir':
        options.testsDir = String(value)
        index += 1
        break
      case '--json':
        options.json = String(value)
        index += 1
        break
      case '--out':
        options.out = String(value)
        index += 1
        break
      case '--top':
        options.top = Number(value)
        index += 1
        break
      default:
        break
    }
  }
  return options
}

/** @param {string} directory @returns {string[]} */
function jsonFilesUnder(directory) {
  /** @type {string[]} */
  const found = []
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry)
    if (statSync(full).isDirectory()) {
      found.push(...jsonFilesUnder(full))
    } else if (entry.endsWith('.json')) {
      found.push(full)
    }
  }
  return found.sort()
}

/** @param {string} directory */
export function loadReports(directory) {
  return jsonFilesUnder(directory)
    .map((file) => {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      // `.last-run.json` and trace metadata share the artifact tree.
      return parsed && Array.isArray(parsed.suites)
        ? parseReport(parsed, path.relative(directory, file))
        : null
    })
    .filter((report) => report !== null)
}

/** @param {string} directory */
export function loadCensus(directory) {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.spec.ts'))
    .sort()
    .map((entry) => censusSpecSource(entry, readFileSync(path.join(directory, entry), 'utf8')))
}

/** @param {string} text */
function cell(text) {
  return String(text).replaceAll('|', '\\|')
}

/**
 * @param {ReturnType<typeof aggregateReports>} aggregate
 * @param {ReturnType<typeof summarizeCensus>} census
 * @param {number} top
 */
export function renderReport(aggregate, census, top) {
  const { totals, runs, specs } = aggregate
  const failing = specs.filter((entry) => entry.failures > 0).slice(0, top)
  const unexecuted = specs.filter((entry) => entry.executions === 0)
  const incompleteRuns = runs.filter((run) => run.missingShards.length > 0)
  const orphanFixmes = census.fixmes.filter((entry) => entry.ticket === null)
  const lines = [
    '## E2E failure rate by spec',
    '',
    `${totals.reports} report(s) over ${runs.length} run attempt(s): ${totals.executions} execution(s), ${totals.failures} failure(s) across ${totals.failingSpecs} spec(s).`,
    '',
    'Rate denominator is the number of runs in which that spec actually executed — skipped, fixme and interrupted tests are excluded from it and counted below instead.',
    ''
  ]
  if (incompleteRuns.length > 0) {
    lines.push(
      '### Runs missing a shard',
      '',
      'Every spec in a missing shard is absent from the denominators above.',
      '',
      '| Run attempt | Shards seen | Missing |',
      '| --- | --- | --- |',
      ...incompleteRuns.map(
        (run) =>
          `| ${cell(run.runKey)} | ${run.shardsSeen.length}/${run.shardTotal} | ${run.missingShards.join(', ')} |`
      ),
      ''
    )
  }
  lines.push(
    failing.length === 0
      ? '### No spec failed in the harvested reports'
      : '### Specs by failure rate',
    ''
  )
  if (failing.length > 0) {
    lines.push(
      '| Spec | Failed / executed | Rate | First failure message |',
      '| --- | --- | --- | --- |',
      ...failing.map(
        (entry) =>
          `| ${cell(`${entry.file}:${entry.line}`)} › ${cell(entry.title)} | ${entry.failures}/${entry.executions} | ${formatRate(entry.failureRate)} | ${cell(entry.reasons[0] ?? '')} |`
      ),
      ''
    )
  }
  lines.push(
    '### Counted, not measured',
    '',
    'Test-run counts come from the harvested reports, so they cover only the project those runs used; declaration counts are a scan of the whole spec tree.',
    '',
    '| Population | Count |',
    '| --- | --- |',
    `| Tests present in a report but never executed | ${unexecuted.length} |`,
    `| Skipped test runs (conditional gate) | ${totals.skipped} |`,
    `| Fixme test runs | ${totals.fixme} |`,
    `| Interrupted test runs | ${totals.interrupted} |`,
    `| Flaky test runs (passed on a retry) | ${totals.flaky} |`,
    `| \`@headful\` declarations (no CI lane runs them) | ${census.totals.headfulDeclarations} |`,
    `| \`@ondemand\` declarations (no CI lane runs them) | ${census.totals.ondemandDeclarations} |`,
    `| \`test.fixme\` declarations in the tree | ${census.totals.fixmes} |`,
    `| Conditional \`test.skip\` gates in the tree | ${census.totals.gates} |`,
    `| …of those, gates that green a missing global setup | ${census.totals.globalSetupGates} |`,
    ''
  )
  if (orphanFixmes.length > 0) {
    lines.push(
      '### Fixme without a ticket',
      '',
      ...orphanFixmes.map((entry) => `- \`${entry.file}:${entry.line}\` — ${cell(entry.title)}`),
      ''
    )
  }
  return lines.join('\n')
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const reports = loadReports(options.reports)
  const aggregate = aggregateReports(reports)
  const census = summarizeCensus(loadCensus(options.testsDir))
  const markdown = renderReport(aggregate, census, options.top)
  if (options.out) {
    writeFileSync(options.out, markdown)
  }
  if (options.json) {
    writeFileSync(
      options.json,
      `${JSON.stringify({ ...aggregate, census: census.totals }, null, 2)}\n`
    )
  }
  process.stdout.write(`${markdown}\n`)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
