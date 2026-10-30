import { describe, expect, it } from 'vitest'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const none = async () => null

const base = {
  settings: undefined,
  worktree: null,
  agents: [],
  leaderPaneKey: null,
  readReview: none,
  readPlane: none,
  readLinear: none
}

describe('buildOrchestratorGameState board', () => {
  it("carries the project's STOP, or null when it is clear", async () => {
    const stop = { since: '2026-10-16T10:00:00.000Z', by: 'lead' }
    expect(
      (await buildOrchestratorGameState({ ...base, readStop: async () => stop })).stopped
    ).toEqual(stop)
    expect((await buildOrchestratorGameState({ ...base, readStop: none })).stopped).toBeNull()
  })

  it('counts STOP as set when it cannot be read, and says so', async () => {
    const state = await buildOrchestratorGameState({
      ...base,
      readStop: async () => {
        throw new Error('EACCES')
      }
    })
    expect(state.stopped).toEqual({ since: null, by: null, unreadable: true })
    expect(state.warnings).toContain('STOP cannot be read (EACCES); it counts as set')
  })

  it('leaves stopped out when the host has no board to read', async () => {
    expect('stopped' in (await buildOrchestratorGameState(base))).toBe(false)
  })
})

describe('buildOrchestratorGameState inboxes', () => {
  const inboxes = [{ key: 'lead', unread: 2, last: null, waiting: [] }]

  it("gives the lead the project's inboxes with unread counts", async () => {
    const state = await buildOrchestratorGameState({ ...base, readInboxes: async () => inboxes })
    expect(state.inboxes).toEqual(inboxes)
  })

  it('gives a member none, and leaves them out when they cannot be read', async () => {
    const member = await buildOrchestratorGameState({
      ...base,
      callerParentPaneKey: 'tab:lead',
      readInboxes: async () => inboxes
    })
    expect('inboxes' in member).toBe(false)
    const failed = await buildOrchestratorGameState({
      ...base,
      readInboxes: async () => {
        throw new Error('db closed')
      }
    })
    expect('inboxes' in failed).toBe(false)
  })
})

describe('buildOrchestratorGameState owner questions', () => {
  it('gives the lead the count of questions waiting on the person, a member none', async () => {
    const lead = await buildOrchestratorGameState({
      ...base,
      readOpenOwnerQuestions: async () => 2
    })
    expect(lead.openOwnerQuestions).toBe(2)
    const member = await buildOrchestratorGameState({
      ...base,
      callerParentPaneKey: 'tab:lead',
      readOpenOwnerQuestions: async () => 2
    })
    expect('openOwnerQuestions' in member).toBe(false)
    const failed = await buildOrchestratorGameState({
      ...base,
      readOpenOwnerQuestions: async () => {
        throw new Error('EACCES')
      }
    })
    expect('openOwnerQuestions' in failed).toBe(false)
  })
})

describe('buildOrchestratorGameState GitHub budget', () => {
  const budget = {
    graphql: { limit: 5000, remaining: 400, resetAt: 1, orcaCalls: 30 },
    core: { limit: 5000, remaining: 4000, resetAt: 1, orcaCalls: 2 },
    top: [],
    low: true
  }

  it('carries the GitHub budget to the lead and to a member', async () => {
    const readGitHubBudget = async () => budget
    expect((await buildOrchestratorGameState({ ...base, readGitHubBudget })).githubBudget).toEqual(
      budget
    )
    const member = await buildOrchestratorGameState({
      ...base,
      callerParentPaneKey: 'tab:lead',
      readGitHubBudget
    })
    expect(member.githubBudget).toEqual(budget)
  })

  it('leaves it out when it cannot be read', async () => {
    const state = await buildOrchestratorGameState({
      ...base,
      readGitHubBudget: async () => {
        throw new Error('gh not found')
      }
    })
    expect('githubBudget' in state).toBe(false)
  })
})
