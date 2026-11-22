import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const none = async () => null

const stateWith = (panel: Record<string, unknown>) => {
  const path = mkdtempSync(join(tmpdir(), 'orca-game-panel-'))
  dirs.push(path)
  return buildOrchestratorGameState({
    settings: { orchestratorGame: { panel } },
    worktree: {
      id: 'wt1',
      repoId: 'repo1',
      path,
      branch: 'feat/game',
      displayName: 'Game',
      linkedWorkItem: null
    },
    agents: [],
    leaderPaneKey: null,
    readReview: none,
    readPlane: none,
    readLinear: none
  })
}

// Why: a phone draws the 3D Office only for a host that says so; an older host says nothing (ORCA-1334).
describe('the panel the phone reads', () => {
  it('says this host draws the Office in 3D only when the Office is at Illustrated', async () => {
    const { panel } = await stateWith({ look: 'game', style: 'office', quality: 'high' })
    expect(panel).toMatchObject({ style: 'office', quality: 'high', office3d: true })
    for (const one of [
      { style: 'office', quality: 'low' },
      { style: 'figures', quality: 'high' }
    ]) {
      expect((await stateWith({ look: 'game', ...one })).panel).not.toHaveProperty('office3d')
    }
  })
})
