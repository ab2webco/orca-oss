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
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-list-actions-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'orca.yaml'), orcaYaml)
  return dir
}

const none = async () => null

function worktree(path: string) {
  return {
    id: 'wt1',
    repoId: 'repo1',
    path,
    branch: 'feat/game',
    displayName: 'Game',
    linkedWorkItem: null
  }
}

describe('the actions the PR and To Do lists run', () => {
  it('names the action the To Do runs, by command or id, and warns when none has that name', async () => {
    const stateWith = (action: string) =>
      buildOrchestratorGameState({
        settings: undefined,
        worktree: worktree(
          checkout(
            [
              'orchestratorGame:',
              '  todo:',
              '    provider: jira',
              `    action: ${action}`,
              '  actions:',
              '    - label: Jira',
              '      command: jira',
              "      prompt: 'Show my To Do with the jira CLI'",
              ''
            ].join('\n')
          )
        ),
        agents: [],
        leaderPaneKey: null,
        readReview: none,
        readPlane: none,
        readLinear: none,
        readProjectWork: async () => ({
          reviews: null,
          todo: { provider: 'jira', total: 0, url: 'https://jira.example/issues/', items: [] }
        })
      })

    expect((await stateWith('jira')).project?.todo?.actionId).toBe('action-0')
    expect((await stateWith('lead:status')).project?.todo?.actionId).toBe('lead:status')
    const missing = await stateWith('nope')
    expect(missing.project?.todo?.actionId).toBeUndefined()
    expect(missing.warnings).toContain('orchestratorGame.todo.action names no action: nope')
  })

  it('names the action the PR list runs, and warns when none has that name', async () => {
    const stateWith = (action: string) =>
      buildOrchestratorGameState({
        settings: undefined,
        worktree: worktree(
          checkout(
            [
              'orchestratorGame:',
              '  reviews:',
              `    action: ${action}`,
              '  actions:',
              '    - label: PRs',
              '      command: prs',
              "      prompt: 'Show my PRs with gh'",
              ''
            ].join('\n')
          )
        ),
        agents: [],
        leaderPaneKey: null,
        readReview: none,
        readPlane: none,
        readLinear: none,
        readProjectWork: async () => ({
          reviews: { provider: 'github', total: 0, url: 'https://github.com/o/r/pulls', items: [] },
          todo: null
        })
      })

    expect((await stateWith('prs')).project?.reviews?.actionId).toBe('action-0')
    const missing = await stateWith('nope')
    expect(missing.project?.reviews?.actionId).toBeUndefined()
    expect(missing.warnings).toContain('orchestratorGame.reviews.action names no action: nope')
  })
})
