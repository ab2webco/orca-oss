import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why this guard: an upstream sync reintroducing one of these URLs sends a Lab
// user's bug report to maintainers who cannot act on it, or shows them release
// notes for a build they never installed. Both regressions are invisible in a
// diff review and silent at runtime (ORCA-192).
const FORK_OWNED_SURFACES = [
  'main/ipc/feedback.ts',
  'main/ipc/crash-reporting.ts',
  'main/fork-issue-url.ts',
  'main/updater-changelog.ts'
]

const UPSTREAM_HOST = /onorca\.dev/

describe('fork-owned user report and What’s New surfaces', () => {
  it('never names an upstream host', () => {
    const srcRoot = join(import.meta.dirname, '..')
    const offenders = FORK_OWNED_SURFACES.filter((file) =>
      UPSTREAM_HOST.test(readFileSync(join(srcRoot, file), 'utf8'))
    )

    expect(offenders, 'These surfaces must resolve to this fork, not upstream').toEqual([])
  })
})
