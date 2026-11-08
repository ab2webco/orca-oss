import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { checkTree } from './renderer-brand-drift-allowlist.mjs'
import { NEW_NAME } from './renderer-translate-fallbacks.mjs'

/**
 * Pins the renderer fallbacks to the committed allowlist.
 *
 * This half proves today's tree has no stale fallback the allowlist does not
 * name. The other half — that the allowlist may only shrink — needs the PR base
 * and lives in `check-renderer-brand-drift-ratchet.mjs`, which `pnpm lint` runs.
 */
const REPO_ROOT = path.join(import.meta.dirname, '..', '..')

// Loose floor: it only catches a parser that stops matching almost everything.
const MIN_PARSED_CALLS = 12_000

const { calls, unresolved, violations } = checkTree(REPO_ROOT)

describe(`renderer translate() fallbacks follow the ${NEW_NAME} catalog`, () => {
  it('parses the renderer translate() calls it claims to cover', () => {
    expect(calls.length).toBeGreaterThan(MIN_PARSED_CALLS)
  })

  it('resolves every parsed key in the catalog', () => {
    // A key that resolves to nothing renders its fallback, so no drift exists to
    // find there — the check would silently cover less than it claims.
    expect(unresolved.map((call) => `${call.file}:${call.line} ${call.key}`)).toEqual([])
  })

  it('has no stale fallback outside the allowlist', () => {
    expect(violations.map((violation) => violation.message)).toEqual([])
  })
})
