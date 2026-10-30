import { describe, expect, it } from 'vitest'

import { withGameMemberIdentity } from './orchestrator-game-member-identity'
import type { GameAgent, GameReview, OrchestratorGameState } from './orchestrator-game-state'

const RECOVERY = 'RECOVERY BRIEF. Orca restarted while you were working.'

const review = (number: number, ci: GameReview['ci']): GameReview => ({
  provider: 'github',
  number,
  title: 'Cartelera',
  url: `https://github.com/o/r/pull/${number}`,
  state: 'open',
  ci
})

const agent = (overrides: Partial<GameAgent>): GameAgent => ({
  paneKey: 'p',
  displayName: RECOVERY,
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  isMember: true,
  ...overrides
})

const stateOf = (
  agents: GameAgent[],
  lead: Partial<Pick<OrchestratorGameState, 'worktree' | 'review'>> = {}
): OrchestratorGameState =>
  ({
    agents,
    worktree: { id: 'wt-lead', path: '/r/cineco', branch: 'main', displayName: 'cineco' },
    review: null,
    ...lead
  }) as OrchestratorGameState

describe('withGameMemberIdentity', () => {
  it('tells apart two recovered members of one ticket by host, account, branch, PR and CI', () => {
    const local = agent({
      paneKey: 'tab:a',
      worktree: { id: 'wt-a', branch: 'fab/cin-1231-cartelera', displayName: RECOVERY },
      review: review(41, 'failure'),
      account: { provider: 'claude', id: 'acc-1', email: 'one@cineco.co' }
    })
    const remote = agent({
      paneKey: 'remote:ctx_1',
      remote: { host: 'imac', stateKnown: true },
      worktree: { id: 'wt-b', branch: 'fab/cin-1231-retry', displayName: RECOVERY },
      review: review(42, 'pending'),
      account: { provider: 'claude', id: 'remote:env:two@cineco.co', email: 'two@cineco.co' }
    })

    const [one, two] = withGameMemberIdentity(stateOf([local, remote])).agents

    expect(one).toMatchObject({
      ticket: 'CIN-1231',
      host: 'local',
      accountEmail: 'one@cineco.co',
      worktreeId: 'wt-a',
      branch: 'fab/cin-1231-cartelera',
      pr: 41,
      ci: 'failure'
    })
    expect(two).toMatchObject({
      ticket: 'CIN-1231',
      host: 'imac',
      accountEmail: 'two@cineco.co',
      worktreeId: 'wt-b',
      branch: 'fab/cin-1231-retry',
      pr: 42,
      ci: 'pending'
    })
  })

  it("never lends the lead's worktree or PR to a local member whose worktree is not resolved", () => {
    const [member] = withGameMemberIdentity(
      stateOf([agent({ displayName: 'CIN-7 Taquilla' })], { review: review(9, 'success') })
    ).agents

    expect(member).toMatchObject({ ticket: 'CIN-7', host: 'local' })
    for (const key of ['worktreeId', 'branch', 'pr', 'ci', 'accountEmail']) {
      expect(member).not.toHaveProperty(key)
    }
  })

  it("never lends the lead's worktree to a remote member whose host did not answer", () => {
    const [member] = withGameMemberIdentity(
      stateOf([agent({ remote: { host: 'm1', stateKnown: false } })], {
        review: review(9, 'success')
      })
    ).agents

    expect(member).toEqual({
      ...agent({ remote: { host: 'm1', stateKnown: false } }),
      host: 'm1'
    })
  })

  it('leaves the lead and other non-members as the host sent them', () => {
    const lead = agent({ paneKey: 'lead', isLeader: true, isMember: undefined })
    const plain = agent({ paneKey: 'plain', isMember: undefined })

    expect(withGameMemberIdentity(stateOf([lead, plain])).agents).toEqual([lead, plain])
  })

  it('passes an answer without agents through untouched', () => {
    const bare = { config: { mode: 'zen' } } as unknown as OrchestratorGameState

    expect(withGameMemberIdentity(bare)).toBe(bare)
  })
})
