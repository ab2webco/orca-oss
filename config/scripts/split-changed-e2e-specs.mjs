#!/usr/bin/env node
// Splits the PR's changed E2E specs into the shards e2e.yml's changed-e2e job runs, and writes the
// GitHub matrix to $GITHUB_OUTPUT as `matrix=[{ name, files }]`.
//
// Why not Playwright's --shard: it cuts the sorted list into runs of equal test count, so the
// heavy team-panel-* specs, which sort together, all landed in the last shard. On one runner the
// panel branch's 16 changed specs took 28 to 30 minutes against the job's 30 (ORCA-1120).
import { appendFileSync, readFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Why 12: the full suite's count; #1191's 131 specs (140 measured minutes) need 10 (ORCA-1155).
export const MAX_SHARDS = 12
// Why 6: #936's 55 specs (79 min) put 32.6 min on one of 4 shards and 21 on one of 5; 6 tops out at 18.3 (ORCA-1142).
const COUNT_SHARDS = 6
// Why 4: a short list stays on one runner, since every shard pays about 2 minutes of setup.
export const SPECS_PER_SHARD = 4
// Why half the 30-minute cap: the record runs low; #1191's 24.7 measured minutes ran past 28 (ORCA-1155).
export const SHARD_BUDGET_SECONDS = 15 * 60
export const DURATIONS_FILE = 'config/e2e-spec-durations.json'
// Why a floor: at 0 every skipped spec lands on the same lightest shard, and a skip can end.
const FLOOR_SECONDS = 5

const sizeOnDisk = (file) => {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/** @returns {Record<string, number>} seconds each spec file took on CI, by repo path. */
export function readDurations(mapFile = DURATIONS_FILE) {
  return JSON.parse(readFileSync(mapFile, 'utf8')).seconds
}

/**
 * Measured seconds (at least the floor) where the map has them; otherwise size at the list's own
 * seconds per byte, so a new spec lands somewhere sensible until the next refresh measures it.
 * @param {string[]} files
 * @param {{ durations: Record<string, number>, sizeOf: (file: string) => number }} options
 * @returns {(file: string) => number}
 */
export function measuredSecondsOf(files, { durations, sizeOf }) {
  const measured = files.filter((file) => durations[file] > 0)
  const measuredBytes = measured.reduce((sum, file) => sum + sizeOf(file), 0)
  const perByte =
    measuredBytes > 0 ? measured.reduce((sum, file) => sum + durations[file], 0) / measuredBytes : 1
  return (file) =>
    file in durations ? Math.max(durations[file], FLOOR_SECONDS) : sizeOf(file) * perByte
}

/**
 * Slowest spec first onto the lightest shard, with enough shards to keep each under the budget.
 * @param {string[]} files
 * @param {(file: string) => number} [secondsOf]
 * @returns {{ name: string, files: string }[]} `files` is a JSON array, as the run step reads it.
 */
export function splitChangedSpecs(
  files,
  secondsOf = measuredSecondsOf(files, { durations: readDurations(), sizeOf: sizeOnDisk })
) {
  const unique = [...new Set(files)]
  const seconds = unique.reduce((sum, file) => sum + secondsOf(file), 0)
  const total = Math.min(
    MAX_SHARDS,
    Math.max(
      Math.min(COUNT_SHARDS, Math.ceil(unique.length / SPECS_PER_SHARD)),
      Math.ceil(seconds / SHARD_BUDGET_SECONDS)
    )
  )
  return balanceByWeight(unique, total, secondsOf).map((shard, index) => ({
    name: `${index + 1}-of-${total}`,
    files: JSON.stringify(shard.files)
  }))
}

/**
 * Heaviest first onto the lightest shard (LPT); ties break by name, so the plan is stable.
 * @param {string[]} files
 * @param {number} total
 * @param {(file: string) => number} weightOf
 * @returns {{ weight: number, files: string[] }[]} each shard's files sorted.
 */
export function balanceByWeight(files, total, weightOf) {
  const shards = Array.from({ length: total }, () => ({ weight: 0, files: [] }))
  const byWeight = [...new Set(files)]
    .map((file) => ({ file, weight: weightOf(file) }))
    .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file))
  for (const { file, weight } of byWeight) {
    const lightest = shards.reduce((best, shard) => (shard.weight < best.weight ? shard : best))
    lightest.weight += weight
    lightest.files.push(file)
  }
  for (const shard of shards) {
    shard.files.sort()
  }
  return shards
}

export function main({
  testFilesJson = process.env.TEST_FILES_JSON ?? '',
  output = process.env.GITHUB_OUTPUT,
  log = console.log
} = {}) {
  const files = testFilesJson.trim() === '' ? [] : JSON.parse(testFilesJson)
  const matrix = splitChangedSpecs(files)
  if (output) {
    appendFileSync(output, `matrix=${JSON.stringify(matrix)}\n`)
  }
  for (const shard of matrix) {
    log(`changed e2e specs ${shard.name}: ${JSON.parse(shard.files).join(' ')}`)
  }
  return matrix
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
