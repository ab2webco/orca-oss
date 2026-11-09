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
// #936's 55 changed specs at panel tip c85b7b8: [seconds on CI, bytes on disk]. Seconds are from run
// 42534345470, except work-tabs, cut off there, from #1090's run 42527729456. Shard 2 of that run hit
// the 30-minute job limit (ORCA-1142).
const RUN_936 = {
  'agent-dashboard-narrow-sheet.spec.ts': [102, 13829],
  'dispatch-capability-redaction.spec.ts': [129, 18611],
  'folder-workspace-survives-cold-restart.spec.ts': [31, 4835],
  'game-actions-settings-narrow.spec.ts': [32, 6387],
  'game-actions-settings.spec.ts': [72, 10443],
  'game-adopted-member-restart.spec.ts': [36, 14231],
  'game-adopted-same-name-threads.spec.ts': [23, 7659],
  'game-cycle-without-plugins.spec.ts': [46, 9847],
  'game-folder-workspace-team.spec.ts': [133, 9941],
  'game-inbox-across-projects.spec.ts': [37, 8043],
  'game-inbox-showcase.spec.ts': [30, 7203],
  'game-inbox-threads.spec.ts': [132, 11831],
  'game-inbox.spec.ts': [72, 7348],
  'game-lead-restart-registry.spec.ts': [22, 5854],
  'game-owner-answer-wakes-lead.spec.ts': [84, 6223],
  'game-panel-settings.spec.ts': [194, 8728],
  'game-text-layer-without-plugins.spec.ts': [0, 7894],
  'orca-game-arcade-tab.spec.ts': [42, 4616],
  'orca-game-message-copy.spec.ts': [0, 13937],
  'orca-game-terminal-colours.spec.ts': [0, 12863],
  'orca-game-terminal-text-layer.spec.ts': [0, 7481],
  'orchestrator-game-perfect-merge-toast.spec.ts': [0, 6510],
  'settings-game-style-fallback-note.spec.ts': [42, 1763],
  'settings-orchestrator-game.spec.ts': [529, 33690],
  'setup-script-prompt-sidebar-rows.spec.ts': [23, 5102],
  'sidebar-unread-row-status-glyph.spec.ts': [20, 2397],
  'status-colors-settings.spec.ts': [19, 4763],
  'status-tones-sidebar.spec.ts': [19, 8697],
  'team-panel-action-dock.spec.ts': [72, 22166],
  'team-panel-activity-final.spec.ts': [12, 3785],
  'team-panel-activity.spec.ts': [264, 19838],
  'team-panel-agent-questions.spec.ts': [65, 15858],
  'team-panel-arcade.spec.ts': [108, 8150],
  'team-panel-card-identity.spec.ts': [138, 13570],
  'team-panel-display.spec.ts': [96, 12499],
  'team-panel-folder-workspace-card.spec.ts': [32, 6094],
  'team-panel-idle-lead-restart.spec.ts': [23, 3154],
  'team-panel-inbox-adopted-member.spec.ts': [96, 11484],
  'team-panel-inbox-tab.spec.ts': [41, 16050],
  'team-panel-lead-defaults.spec.ts': [66, 6619],
  'team-panel-lead-one-name.spec.ts': [90, 4216],
  'team-panel-member-question.spec.ts': [84, 12287],
  'team-panel-no-sideways-scroll.spec.ts': [54, 8966],
  'team-panel-queue-machines-advisor.spec.ts': [24, 9924],
  'team-panel-remote-member-card.spec.ts': [48, 6786],
  'team-panel-restored-agent-idle.spec.ts': [45, 6583],
  'team-panel-scene-motion.spec.ts': [57, 12235],
  'team-panel-scene-states.spec.ts': [144, 12820],
  'team-panel-scene.spec.ts': [510, 32922],
  'team-panel-settings-toggles.spec.ts': [78, 13155],
  'team-panel-shell.spec.ts': [30, 2837],
  'team-panel-tab-fit.spec.ts': [81, 11038],
  'team-panel-team-tab.spec.ts': [228, 18801],
  'team-panel-work-tabs.spec.ts': [372, 17962],
  'workspace-board-hint-fit.spec.ts': [29, 2674]
}
// Why 2 minutes: what every shard spends on checkout, install and the artifact before its first test.
const SHARD_SETUP_SECONDS = 120
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

  it("keeps every shard of #936's list under 20 minutes, split by size", () => {
    const files = Object.keys(RUN_936)
    const shards = splitChangedSpecs(files, (file) => RUN_936[file][1])
    const minutes = shards.map(
      (shard) =>
        (filesOf(shard).reduce((sum, file) => sum + RUN_936[file][0], 0) + SHARD_SETUP_SECONDS) / 60
    )
    expect(shards.flatMap(filesOf).sort()).toEqual([...files].sort())
    expect(Math.max(...minutes)).toBeLessThanOrEqual(20)
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
