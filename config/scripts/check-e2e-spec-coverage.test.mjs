import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BASELINE_PATH,
  checkCoverage,
  diffAgainstBaseline,
  findUncoveredSpecs,
  formatBaseline,
  parseBaseline,
  parseListOutput
} from './check-e2e-spec-coverage.mjs'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

afterEach(() => vi.mocked(spawnSync).mockReset())

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

  it('allows a project count increase without --write or changing the baseline', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-coverage-'))
    const baselinePath = path.join(root, BASELINE_PATH)
    const baseline = formatBaseline(
      new Map([
        ['electron-headless', 1],
        ['electron-ondemand', 1],
        ['electron-headful', 1]
      ])
    )
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
    fs.mkdirSync(path.join(root, 'tests/e2e'), { recursive: true })
    fs.writeFileSync(baselinePath, baseline)
    fs.writeFileSync(path.join(root, 'tests/e2e/example.spec.ts'), '')
    vi.mocked(spawnSync).mockImplementation((_command, args) => ({
      status: 0,
      stdout: `  [${args.at(-1)}] › example.spec.ts:1:1 › example\nTotal: ${args.at(-1) === 'electron-headless' ? 2 : 1} tests in 1 file`,
      stderr: ''
    }))

    try {
      expect(checkCoverage(root).differences).toEqual([])
      expect(fs.readFileSync(baselinePath, 'utf8')).toBe(baseline)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a missing project baseline', () => {
    expect(
      diffAgainstBaseline(
        new Map([
          ['electron-headless', 2],
          ['electron-ondemand', 1],
          ['electron-headful', 1]
        ]),
        new Map([
          ['electron-ondemand', 1],
          ['electron-headful', 1]
        ])
      )
    ).toEqual([{ project: 'electron-headless', current: 2, expected: 0 }])
  })
})
