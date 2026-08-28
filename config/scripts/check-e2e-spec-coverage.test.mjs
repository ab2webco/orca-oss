import { describe, expect, it } from 'vitest'
import {
  diffAgainstBaseline,
  findUncoveredSpecs,
  formatBaseline,
  parseBaseline,
  parseListOutput
} from './check-e2e-spec-coverage.mjs'

describe('E2E spec coverage check', () => {
  it('parses collected files and test counts', () => {
    const result = parseListOutput(
      '  [electron-headless] › foo.spec.ts:12:3 › example\nTotal: 2 tests in 1 file',
      'electron-headless'
    )
    expect(result.files).toEqual(new Set(['tests/e2e/foo.spec.ts']))
    expect(result.tests).toBe(2)
  })

  it('fails coverage when a spec drops out of every project', () => {
    expect(
      findUncoveredSpecs(new Set(['tests/e2e/kept.spec.ts', 'tests/e2e/orca-326-empty.spec.ts']), [
        new Set(['tests/e2e/kept.spec.ts'])
      ])
    ).toEqual(['tests/e2e/orca-326-empty.spec.ts'])
  })

  it('requires deliberate per-project count ratchet updates', () => {
    const baseline = parseBaseline(
      formatBaseline(
        new Map([
          ['electron-headless', 575],
          ['electron-ondemand', 6],
          ['electron-headful', 43]
        ])
      )
    )
    expect(
      diffAgainstBaseline(
        new Map([
          ['electron-headless', 574],
          ['electron-ondemand', 6],
          ['electron-headful', 43]
        ]),
        baseline
      )
    ).toEqual([{ project: 'electron-headless', current: 574, expected: 575 }])
  })
})
