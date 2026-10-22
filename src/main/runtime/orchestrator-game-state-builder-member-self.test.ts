import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const none = async () => null
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function worktree() {
  const path = mkdtempSync(join(tmpdir(), 'orca-game-member-'))
  dirs.push(path)
  return {
    id: 'wt1',
    repoId: 'repo1',
    path,
    branch: 'cin-12',
    displayName: 'CIN-12',
    linkedWorkItem: null
  }
}

describe('buildOrchestratorGameState for a member pane', () => {
  it('keeps a member pane its own row, so its band can name it', async () => {
    const self = {
      state: 'working' as const,
      agentType: 'claude',
      displayName: 'Arthur · CIN-12',
      taskTitle: null,
      toolName: null,
      paneKey: 'tab:member',
      parentPaneKey: 'tab:lead'
    }
    const member = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [self, { ...self, paneKey: 'tab:other', displayName: 'Lancelot · CIN-13' }],
      leaderPaneKey: 'tab:member',
      callerParentPaneKey: 'tab:lead',
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(member.agents.map((one) => [one.displayName, one.isLeader])).toEqual([
      ['Arthur · CIN-12', true]
    ])
  })

  it('reads no tracker for a member, whose band takes the ticket from its own name', async () => {
    const reads: string[] = []
    const build = (callerParentPaneKey: string | null) =>
      buildOrchestratorGameState({
        settings: undefined,
        worktree: worktree(),
        agents: [],
        leaderPaneKey: 'tab:member',
        callerParentPaneKey,
        readReview: none,
        readPlane: async () => {
          reads.push('plane')
          return null
        },
        readLinear: async () => {
          reads.push('linear')
          return null
        }
      })

    await build('tab:lead')
    expect(reads).toEqual([])
    await build(null)
    expect(reads).toEqual(['plane', 'linear'])
  })
})
