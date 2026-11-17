import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SUITE_BUDGET_SECONDS,
  SUITE_SHARDS,
  durationsFromReports,
  main,
  planSuiteShards,
  readDurations,
  refreshDurations
} from './split-e2e-suite-specs.mjs'

const specsOnDisk = readdirSync('tests/e2e')
  .filter((file) => file.endsWith('.spec.ts'))
  .map((file) => `tests/e2e/${file}`)
const sizeOf = (file) => statSync(file).size
const filesOf = (shard) => JSON.parse(shard.files)
const durations = readDurations()
// Why the map's own figure where it has one: that is what each spec took on CI.
const secondsOf = (file) => durations[file] ?? 0
describe('planSuiteShards', () => {
  it('runs every spec on disk exactly once, across at least twelve shards', () => {
    const shards = planSuiteShards(specsOnDisk, { durations, sizeOf })
    expect(shards.length).toBeGreaterThanOrEqual(SUITE_SHARDS)
    expect(shards.map((shard) => shard.shard_name)).toEqual(
      Array.from({ length: shards.length }, (_, i) => `${i + 1}-of-${shards.length}`)
    )
    expect(shards.flatMap(filesOf).sort()).toEqual([...specsOnDisk].sort())
    expect(shards.every((shard) => filesOf(shard).length > 0)).toBe(true)
  })

  // Run 42563987741: --shard cut the sorted list by test count, so the one-test team-panel-* specs
  // (about 40 minutes) all fell in shard 8, which hit its 45-minute cap with 30 tests unrun (ORCA-1148).
  it('spreads the team-panel specs instead of stacking them on one shard', () => {
    const shards = planSuiteShards(specsOnDisk, { durations, sizeOf })
    const isPanel = (file) => file.includes('/team-panel-')
    const panelMinutes = (files) =>
      files.filter(isPanel).reduce((sum, file) => sum + secondsOf(file), 0) / 60
    const most = Math.max(...shards.map((shard) => panelMinutes(filesOf(shard))))
    expect(most).toBeLessThanOrEqual(panelMinutes(specsOnDisk) / 3)
  })

  // Merge group 44166014367: twelve shards held about 34 measured minutes each, and shard 12 hit its
  // 45-minute cap; a run takes about 6% longer than its tests' sum, plus 2 minutes of setup (ORCA-1272).
  it('plans no shard of the suite over its budget', () => {
    const shards = planSuiteShards(specsOnDisk, { durations, sizeOf })
    expect(Math.max(...shards.map((shard) => shard.seconds))).toBeLessThanOrEqual(
      SUITE_BUDGET_SECONDS
    )
  })

  it('adds shards until none is over the budget', () => {
    const files = Array.from({ length: 30 }, (_, i) => `slow-${i}.spec.ts`)
    const shards = planSuiteShards(files, {
      durations: Object.fromEntries(files.map((file) => [file, 600])),
      sizeOf: () => 1000
    })
    // Twelve shards would put three 10-minute specs on six of them, past the 28-minute budget.
    expect(shards).toHaveLength(15)
    expect(shards.every((shard) => shard.seconds <= SUITE_BUDGET_SECONDS)).toBe(true)
  })

  // Why: an unmeasured spec is priced by guess, and seven of them sat on shard 12 of 44166014367.
  // A spec on a PR's changed list gets its figure from that run's e2e-json-report-changed-* reports;
  // one that only runs @headful or @ondemand never runs in the suite's shards, so its figure is 0.
  it('has a figure for every spec on disk', () => {
    expect(specsOnDisk.filter((file) => !(file in durations))).toEqual([])
  })

  it('weighs a spec the map has no figure for by its size', () => {
    const files = ['a.spec.ts', 'b.spec.ts', 'new-heavy.spec.ts']
    const shards = planSuiteShards(files, {
      durations: { 'a.spec.ts': 100, 'b.spec.ts': 100 },
      sizeOf: (file) => (file === 'new-heavy.spec.ts' ? 3000 : 1000),
      minShards: 2
    })
    // At the map's 0.1 s per byte the new spec weighs 300 s, so it rides alone.
    expect(shards.map(filesOf)).toEqual([['new-heavy.spec.ts'], ['a.spec.ts', 'b.spec.ts']])
  })

  // Why: at 0 every skipped spec would go to the same lightest shard, and a skip can end.
  it('spreads the specs that measured 0 s instead of piling them on one shard', () => {
    const skipped = Array.from({ length: 12 }, (_, i) => `skipped-${i}.spec.ts`)
    const shards = planSuiteShards(['slow.spec.ts', 'fast.spec.ts', ...skipped], {
      durations: {
        'slow.spec.ts': 100,
        'fast.spec.ts': 70,
        ...Object.fromEntries(skipped.map((file) => [file, 0]))
      },
      sizeOf: () => 1000,
      minShards: 2
    })
    const counts = shards.map((shard) => filesOf(shard).filter((f) => f.startsWith('skipped')))
    expect(Math.abs(counts[0].length - counts[1].length)).toBeLessThanOrEqual(6)
    expect(counts.every((one) => one.length > 0)).toBe(true)
  })

  // Why: they skipped for want of Claude Code in run 42563987741; e2e.yml installs it now (ORCA-1148 T2).
  it('carries a run time, not a skip time, for the specs gated on Claude Code', () => {
    // The other five tested the terminal band and arcade ORCA-1055 removed, and were deleted.
    const skippedForClaude = [
      'game-text-layer-without-plugins',
      'orca-game-message-copy',
      'orca-game-terminal-colours',
      'orca-game-terminal-text-layer',
      'orchestrator-game-perfect-merge-toast'
    ].map((name) => `tests/e2e/${name}.spec.ts`)
    for (const file of skippedForClaude) {
      expect(readFileSync(file, 'utf8')).toContain('claudeVersionOk')
    }
    expect(skippedForClaude.filter((file) => !(durations[file] > 0))).toEqual([])
  })

  it('gives the same plan for the same input, whatever the listing order', () => {
    const forward = planSuiteShards(specsOnDisk, { durations, sizeOf })
    const backward = planSuiteShards(specsOnDisk.toReversed(), { durations, sizeOf })
    expect(backward).toEqual(forward)
  })
})

const report = (specs) => ({
  suites: [
    {
      file: 'outer.spec.ts',
      specs: [],
      suites: [{ specs }]
    }
  ]
})
const spec = (file, ...durationsMs) => ({
  file,
  tests: [{ results: durationsMs.map((duration) => ({ duration })) }]
})

describe('durationsFromReports', () => {
  it('sums each spec file across its tests and nested suites, in whole seconds', () => {
    const seconds = durationsFromReports([
      report([spec('one.spec.ts', 20_400), spec('one.spec.ts', 9_800)]),
      report([spec('two.spec.ts', 61_000)])
    ])
    expect(seconds).toEqual({ 'tests/e2e/one.spec.ts': 30, 'tests/e2e/two.spec.ts': 61 })
  })

  it('records a spec that skipped at 0 s', () => {
    expect(durationsFromReports([report([spec('skipped.spec.ts', 3)])])).toEqual({
      'tests/e2e/skipped.spec.ts': 0
    })
  })
})

describe('refreshDurations', () => {
  let dir = ''
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = ''
    }
  })

  it('writes the new figures over the old and drops specs no longer on disk', () => {
    dir = mkdtempSync(join(tmpdir(), 'e2e-durations-'))
    const mapFile = join(dir, 'durations.json')
    writeFileSync(
      mapFile,
      JSON.stringify({
        seconds: {
          'tests/e2e/tabs.spec.ts': 10,
          'tests/e2e/worktree.spec.ts': 50,
          'tests/e2e/deleted.spec.ts': 99
        }
      })
    )
    // The layout `gh run download -p 'e2e-json-report-*'` leaves: one folder per shard.
    const reportDir = join(dir, 'e2e-json-report-1-of-12-attempt-1')
    mkdirSync(reportDir)
    writeFileSync(
      join(reportDir, 'e2e-report.json'),
      JSON.stringify(report([spec('tabs.spec.ts', 77_000)]))
    )
    refreshDurations({ reportsDir: dir, mapFile, source: 'run 1' })
    expect(JSON.parse(readFileSync(mapFile, 'utf8'))).toEqual({
      source: 'run 1',
      seconds: { 'tests/e2e/tabs.spec.ts': 77, 'tests/e2e/worktree.spec.ts': 50 }
    })
  })
})

describe('main', () => {
  let dir = ''
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = ''
    }
  })

  it('writes the matrix the e2e job expands', () => {
    dir = mkdtempSync(join(tmpdir(), 'e2e-suite-shards-'))
    const output = join(dir, 'github-output')
    writeFileSync(output, '')
    const lines = []
    const matrix = main({ output, log: (line) => lines.push(line) })
    const written = readFileSync(output, 'utf8')
    expect(written.startsWith('matrix=')).toBe(true)
    expect(JSON.parse(written.slice('matrix='.length))).toEqual(matrix)
    expect(matrix.flatMap(filesOf).sort()).toEqual([...specsOnDisk].sort())
    expect(lines).toHaveLength(matrix.length)
    expect(lines[0]).toMatch(new RegExp(`^e2e 1-of-${matrix.length}: ~\\d+ min, \\d+ specs$`))
  })
})
