import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_SHARDS, main, splitChangedSpecs } from './split-changed-e2e-specs.mjs'

// The changed specs of the panel branch's run 42350108207, with the seconds each took on CI
// (skipped ones at the 0 they take once they skip before launch). That run timed out at 30 min.
const PANEL_RUN = {
  'tests/e2e/game-cycle-without-plugins.spec.ts': 120,
  'tests/e2e/game-panel-settings.spec.ts': 190,
  'tests/e2e/game-text-layer-without-plugins.spec.ts': 0,
  'tests/e2e/orca-game-arcade-tab.spec.ts': 40,
  'tests/e2e/orca-game-message-copy.spec.ts': 0,
  'tests/e2e/orca-game-terminal-text-layer.spec.ts': 0,
  'tests/e2e/orchestrator-game-perfect-merge-toast.spec.ts': 0,
  'tests/e2e/status-colors-settings.spec.ts': 19,
  'tests/e2e/status-tones-sidebar.spec.ts': 19,
  'tests/e2e/team-panel-arcade.spec.ts': 90,
  'tests/e2e/team-panel-inbox-tab.spec.ts': 37,
  'tests/e2e/team-panel-scene.spec.ts': 444,
  'tests/e2e/team-panel-settings-toggles.spec.ts': 48,
  'tests/e2e/team-panel-shell.spec.ts': 32,
  'tests/e2e/team-panel-team-tab.spec.ts': 165,
  'tests/e2e/team-panel-work-tabs.spec.ts': 360
}
const panelFiles = Object.keys(PANEL_RUN)
const filesOf = (shard) => JSON.parse(shard.files)

describe('splitChangedSpecs', () => {
  it('keeps a short list on one runner', () => {
    const files = panelFiles.slice(0, 4)
    expect(splitChangedSpecs(files, () => 1)).toEqual([
      { name: '1-of-1', files: JSON.stringify([...files].sort()) }
    ])
  })

  it('runs every spec exactly once, whatever the count', () => {
    for (let count = 1; count <= panelFiles.length; count++) {
      const files = panelFiles.slice(0, count)
      const shards = splitChangedSpecs(files, () => 1)
      expect(shards.flatMap(filesOf).sort()).toEqual([...files].sort())
      expect(shards.every((shard) => filesOf(shard).length > 0)).toBe(true)
      expect(shards.length).toBeLessThanOrEqual(MAX_SHARDS)
    }
  })

  // Why: Playwright's --shard put scene, work-tabs and team-tab in one of 4 shards, about 18 minutes.
  it("spreads the panel run's slow specs over the shards", () => {
    const shards = splitChangedSpecs(panelFiles, (file) => PANEL_RUN[file])
    const seconds = shards.map((shard) =>
      filesOf(shard).reduce((sum, file) => sum + PANEL_RUN[file], 0)
    )
    expect(shards.map((shard) => shard.name)).toEqual(['1-of-4', '2-of-4', '3-of-4', '4-of-4'])
    expect(Math.max(...seconds)).toBeLessThanOrEqual(
      PANEL_RUN['tests/e2e/team-panel-scene.spec.ts']
    )
  })

  it('reads the specs off disk by size when no weight is given', () => {
    const shards = splitChangedSpecs(panelFiles)
    const withScene = shards.find((shard) =>
      filesOf(shard).includes('tests/e2e/team-panel-scene.spec.ts')
    )
    expect(filesOf(withScene)).not.toContain('tests/e2e/team-panel-work-tabs.spec.ts')
  })
})

describe('main', () => {
  let dir = ''
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes the matrix output, empty when no spec changed', () => {
    dir = mkdtempSync(join(tmpdir(), 'split-changed-e2e-'))
    const output = join(dir, 'out')
    main({ testFilesJson: '', output, log: () => {} })
    main({ testFilesJson: JSON.stringify(panelFiles.slice(0, 2)), output, log: () => {} })
    const lines = readFileSync(output, 'utf8').trim().split('\n')
    expect(lines[0]).toBe('matrix=[]')
    expect(JSON.parse(lines[1].slice('matrix='.length))).toHaveLength(1)
  })
})
