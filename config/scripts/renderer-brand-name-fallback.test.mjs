import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { measure, NEW_NAME } from './renderer-translate-fallbacks.mjs'

/**
 * Pins the renderer fallback drift to the committed baseline.
 *
 * This half proves the baseline matches TODAY's tree, so new drift, or an edit
 * of the number on its own, goes red. The other half — that the baseline may
 * only ever fall — needs the PR base and lives in
 * `check-renderer-brand-drift-ratchet.mjs`, which `pnpm lint` runs.
 */
const REPO_ROOT = path.join(import.meta.dirname, '..', '..')
const BASELINE = path.join(REPO_ROOT, 'config/renderer-brand-drift-baseline.txt')

// Loose floor, independent of the baseline: it only catches a parser that stops
// matching almost everything. The baseline pins would also move in that case,
// but they move on legitimate work too, so this says the parser still reads a
// renderer's worth of calls at all.
const MIN_PARSED_CALLS = 12_000

function parseBaseline(text) {
  const counts = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const [name, value] = line.split(/\s+/)
    counts[name] = Number.parseInt(value, 10)
  }
  return counts
}

const baseline = parseBaseline(fs.readFileSync(BASELINE, 'utf8'))
const { calls, unresolved, counts } = measure(REPO_ROOT)

describe(`renderer translate() fallbacks follow the ${NEW_NAME} catalog`, () => {
  it('parses the renderer translate() calls it claims to cover', () => {
    expect(calls.length).toBeGreaterThan(MIN_PARSED_CALLS)
  })

  it('resolves every parsed key in the catalog', () => {
    // A key that resolves to nothing renders its fallback, so no drift exists to
    // find there — the counters would silently cover less than they claim.
    expect(unresolved.map((call) => `${call.file}:${call.line} ${call.key}`)).toEqual([])
  })

  it('matches the committed baseline exactly', () => {
    expect(counts).toEqual({
      'rename-drift': baseline['rename-drift'],
      'stale-fallbacks': baseline['stale-fallbacks'],
      'resolved-calls': baseline['resolved-calls']
    })
  })
})
