import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCensus } from './e2e-failure-rate-report.mjs'
import { censusSpecSource, summarizeCensus } from './e2e-unrun-test-census.mjs'

const E2E_DIR = path.join(import.meta.dirname, '..', '..', 'tests', 'e2e')
const treeCensus = summarizeCensus(loadCensus(E2E_DIR))

describe('censusSpecSource', () => {
  it('counts a tag in a declaration and ignores the same tag in a comment', () => {
    const census = censusSpecSource(
      'sample.spec.ts',
      [
        '// Why @headful: the canvas needs a real window.',
        "test('paints after restore @headful', async () => {})",
        "test('runs everywhere', async () => {})"
      ].join('\n')
    )
    expect(census.tagged).toEqual([
      { file: 'sample.spec.ts', line: 2, tag: '@headful', title: 'paints after restore @headful' }
    ])
  })

  it('separates a conditional gate from a declared skip', () => {
    const census = censusSpecSource(
      'sample.spec.ts',
      [
        "  test.skip(!repoPath, 'Global setup did not produce a seeded test repo')",
        "  test.skip(process.platform === 'win32', 'POSIX only')"
      ].join('\n')
    )
    expect(census.gates.map((gate) => gate.globalSetupGate)).toEqual([true, false])
  })

  it('resolves a gate reason hoisted into a constant', () => {
    const census = censusSpecSource(
      'sample.spec.ts',
      [
        "const MISSING_SEEDED_REPO_MESSAGE = 'Global setup did not produce a seeded test repo'",
        '  test.skip(!repoPath, MISSING_SEEDED_REPO_MESSAGE)'
      ].join('\n')
    )
    expect(census.gates).toEqual([
      {
        file: 'sample.spec.ts',
        line: 2,
        reason: 'Global setup did not produce a seeded test repo',
        globalSetupGate: true
      }
    ])
  })

  it('reads a ticket out of the comment block above a fixme', () => {
    const census = censusSpecSource(
      'sample.spec.ts',
      [
        '// Parked until the probe runs on Linux (ORCA-203).',
        "test.fixme('parked case', async () => {})"
      ].join('\n')
    )
    expect(census.fixmes[0]).toEqual({
      file: 'sample.spec.ts',
      line: 2,
      title: 'parked case',
      ticket: 'ORCA-203'
    })
  })
})

describe('the E2E tree it is meant to count', () => {
  it('finds the parked test whose comment names no ticket', () => {
    const orphans = treeCensus.fixmes.filter((entry) => entry.ticket === null)
    expect(orphans).toContainEqual(
      expect.objectContaining({
        file: 'paired-remote-terminal-materialization-reconnect.spec.ts',
        line: 365
      })
    )
  })

  it('attributes the fixmes that do name a ticket', () => {
    const attributed = treeCensus.fixmes.filter((entry) => entry.ticket !== null)
    expect(attributed.length).toBeGreaterThan(treeCensus.fixmes.length / 2)
    expect(attributed).toContainEqual(
      expect.objectContaining({ file: 'tab-create-entry-file-paths.spec.ts', ticket: 'ORCA-204' })
    )
  })

  it('counts the tagged declarations no CI lane runs', () => {
    expect(treeCensus.totals.headfulDeclarations).toBeGreaterThan(30)
    expect(treeCensus.totals.ondemandDeclarations).toBeGreaterThan(0)
    expect(treeCensus.totals.globalSetupGates).toBeGreaterThan(15)
    expect(treeCensus.totals.globalSetupGates).toBeLessThan(treeCensus.totals.gates)
  })
})
