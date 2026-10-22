// `gh api` with a bounded retry on 5xx, writing the response only on success so a
// later step never reads a partial file as valid (ORCA-659).
// Usage: gh-api-with-retry.mjs --output <file> -- <gh api arguments>
import { spawnSync } from 'node:child_process'
import { renameSync, writeFileSync } from 'node:fs'

import {
  TRANSIENT_RETRY_BACKOFF_MS,
  lastHttpStatus,
  runWithTransientRetry
} from './transient-http-retry.mjs'

const separator = process.argv.indexOf('--')
const outputIndex = process.argv.indexOf('--output')
if (separator === -1 || outputIndex === -1 || outputIndex > separator) {
  console.error('Usage: gh-api-with-retry.mjs --output <file> -- <gh api arguments>')
  process.exit(2)
}
const output = process.argv[outputIndex + 1]
const ghArgs = process.argv.slice(separator + 1)
// The first non-flag argument is the endpoint, which the failure message names.
const endpoint = ghArgs.find((arg) => !arg.startsWith('-')) ?? '(no endpoint)'

// Test hook so the retry schedule can run without sleeping through it.
const backoffMs = process.env.ORCA_TRANSIENT_RETRY_BACKOFF_MS
  ? process.env.ORCA_TRANSIENT_RETRY_BACKOFF_MS.split(',').map(Number)
  : TRANSIENT_RETRY_BACKOFF_MS

const outcome = runWithTransientRetry({
  run: () =>
    spawnSync('gh', ['api', ...ghArgs], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }),
  describe: `gh api ${endpoint}`,
  backoffMs
})

if (!outcome.ok) {
  const { result } = outcome
  process.stderr.write(result.stderr ?? '')
  const status = result.error?.message ?? `HTTP ${lastHttpStatus(result.stderr ?? '') ?? 'unknown'}`
  console.error(`gh api ${endpoint} failed after ${outcome.attempts} attempt(s): ${status}`)
  process.exit(1)
}

const partial = `${output}.partial`
writeFileSync(partial, outcome.result.stdout)
renameSync(partial, output)
