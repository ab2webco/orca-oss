#!/usr/bin/env node
// Splits the PR's changed E2E specs into the shards e2e.yml's changed-e2e job runs, and writes the
// GitHub matrix to $GITHUB_OUTPUT as `matrix=[{ name, files }]`.
//
// Why not Playwright's --shard: it cuts the sorted list into runs of equal test count, so the
// heavy team-panel-* specs, which sort together, all landed in the last shard. On one runner the
// panel branch's 16 changed specs took 28 to 30 minutes against the job's 30 (ORCA-1120).
import { appendFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const MAX_SHARDS = 4
// Why 4: a short list stays on one runner, since every shard pays about 2 minutes of setup.
export const SPECS_PER_SHARD = 4

const sizeOf = (file) => {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/**
 * Largest spec first onto the lightest shard. Why size: no duration record exists before the run,
 * and the two largest specs are also the two slowest (team-panel-scene, team-panel-work-tabs).
 * @param {string[]} files
 * @param {(file: string) => number} [weightOf]
 * @returns {{ name: string, files: string }[]} `files` is a JSON array, as the run step reads it.
 */
export function splitChangedSpecs(files, weightOf = sizeOf) {
  const unique = [...new Set(files)]
  const total = Math.min(MAX_SHARDS, Math.ceil(unique.length / SPECS_PER_SHARD))
  const shards = Array.from({ length: total }, () => ({ weight: 0, files: [] }))
  const byWeight = unique
    .map((file) => ({ file, weight: weightOf(file) }))
    .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file))
  for (const { file, weight } of byWeight) {
    const lightest = shards.reduce((best, shard) => (shard.weight < best.weight ? shard : best))
    lightest.weight += weight
    lightest.files.push(file)
  }
  return shards.map((shard, index) => ({
    name: `${index + 1}-of-${total}`,
    files: JSON.stringify(shard.files.sort())
  }))
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
