import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameRepoSummary } from '../../shared/orchestrator-game-member-repo-scope'
import { fakeClient, launch, stateWith } from './orchestrator-game-launch-test-fixtures'

const cineco: GameRepoSummary = {
  id: 'wt1',
  displayName: 'cineco',
  path: '/repo',
  remoteKey: 'github.com/koombea/cineco'
}
const orca: GameRepoSummary = {
  id: 'r_orca',
  displayName: 'orca-oss',
  path: '/work/orca-oss',
  remoteKey: 'github.com/ab2webco/orca-oss'
}
const front: GameRepoSummary = {
  id: 'r_front',
  displayName: 'cineco-frontend',
  path: '/work/cineco-frontend',
  remoteKey: 'github.com/koombea/cineco-frontend'
}

const startedNothing = (calls: [string, unknown][]): void => {
  const methods = calls.map(([method]) => method)
  expect(methods).not.toContain('orchestration.taskCreate')
  expect(methods).not.toContain('orchestration.workerStart')
  expect(methods.filter((method) => method.startsWith('game.memberName'))).toEqual([])
}

describe("orca game launch stays in the lead's own project (ORCA-1156)", () => {
  const saved = { ...process.env }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
    process.env.ORCA_PANE_KEY = 'tab:leaf'
    delete process.env.ORCA_GAME_LOCALE
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('refuses --repo of another project on this host before anything starts', async () => {
    const { client, calls } = fakeClient(stateWith(), undefined, {
      'game.memberRepoScope': { host: null, lead: cineco, repo: orca, repos: [] }
    })

    await expect(launch(client, 'CIN-12', [['repo', 'name:orca-oss']])).rejects.toThrow(
      /--repo name:orca-oss is orca-oss, outside this lead's project \(cineco\)/
    )
    expect(calls.find(([method]) => method === 'game.memberRepoScope')?.[1]).toEqual({
      leadRepo: 'wt1',
      repo: 'name:orca-oss'
    })
    startedNothing(calls)
  })

  it('names the host and the register step when the project is not on the paired host', async () => {
    const { client, calls } = fakeClient(stateWith(), undefined, {
      'game.memberRepoScope': { host: 'm1', lead: cineco, repo: orca, repos: [orca] }
    })

    await expect(
      launch(client, 'CIN-12', [
        ['on', 'm1'],
        ['repo', 'name:orca-oss']
      ])
    ).rejects.toThrow(
      /cineco is not registered on m1.*orca repo add --path <path on m1> --environment m1\. No worktree was created\./
    )
    expect(calls.find(([method]) => method === 'game.memberRepoScope')?.[1]).toEqual({
      leadRepo: 'wt1',
      repo: 'name:orca-oss',
      on: 'm1'
    })
    startedNothing(calls)
  })

  it('launches into a repo the project lists in memberRepos', async () => {
    const { client, calls } = fakeClient(
      stateWith({
        lead: {
          autostart: false,
          cap: 2,
          agent: 'claude',
          memberRepos: ['github.com/koombea/cineco-frontend']
        }
      }),
      undefined,
      { 'game.memberRepoScope': { host: null, lead: cineco, repo: front, repos: [] } }
    )

    await launch(client, 'CIN-12', [['repo', 'name:cineco-frontend']])

    expect(calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ worktree: 'new-top-level', repo: 'name:cineco-frontend' })
    )
  })

  it("does not read repos for a member in the lead's own repo", async () => {
    const { client, calls } = fakeClient(stateWith())

    await launch(client, 'CIN-12')

    expect(calls.map(([method]) => method)).not.toContain('game.memberRepoScope')
    expect(calls.map(([method]) => method)).toContain('orchestration.workerStart')
  })
})
