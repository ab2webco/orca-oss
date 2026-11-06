import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

function checkout(orcaYaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-orca-actions-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'orca.yaml'), orcaYaml)
  return dir
}

const none = async () => null

describe("the project's changes to Orca's lead actions", () => {
  it('sends the icon and pin setup writes, and orcaActions applied to the lead buttons', async () => {
    const yaml = [
      'orchestratorGame:',
      '  tracker: false',
      '  actions:',
      '    - label: Deploy',
      '      command: deploy',
      '      icon: ship',
      '      pin: true',
      '      prompt: Deploy to staging and tell me the result.',
      '  orcaActions:',
      '    wave: { enabled: false }',
      '    sweep: { prompt: Close only with CI green. }',
      ''
    ].join('\n')
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: {
        id: 'wt1',
        repoId: 'repo1',
        path: checkout(yaml),
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

    expect(state.actions?.map((one) => [one.id, one.icon])).toEqual([
      ['lead:status', 'pulse'],
      ['lead:push', 'play'],
      ['lead:sweep', 'check'],
      ['lead:stop', 'stop'],
      ['action-0', 'ship']
    ])
    expect(state.actions?.find((one) => one.id === 'lead:sweep')).toMatchObject({
      prompt: 'Close only with CI green.'
    })
    expect(state.actions?.at(-1)?.pin).toBe(true)
    expect(state.warnings).toEqual([])
  })
})
