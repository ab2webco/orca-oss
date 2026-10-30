import { describe, expect, it } from 'vitest'
import { gameMemberAccountOf, isGameMemberOnGlobalLogin } from './orchestrator-game-member-account'

const roster = [
  { id: 'acct_ana', email: 'ana@example.com' },
  { id: 'acct_bo', email: 'bo@example.com' }
]

describe('gameMemberAccountOf', () => {
  it("names the account the member's live pane runs on before its worktree pin", () => {
    expect(
      gameMemberAccountOf({
        agentType: 'claude',
        live: { known: true, accountId: 'acct_bo', customEndpoint: false },
        pinnedAccountId: 'acct_ana',
        accounts: roster
      })
    ).toEqual({ provider: 'claude', id: 'acct_bo', email: 'bo@example.com' })
  })

  // Why (ORCA-907): `game move` said "already runs on" the spawn record while the process ran elsewhere.
  it('names the account the running process reported before the spawn-time record', () => {
    expect(
      gameMemberAccountOf({
        agentType: 'claude',
        live: { known: true, accountId: 'acct_ana', customEndpoint: false },
        session: { accountId: 'acct_bo' },
        pinnedAccountId: 'acct_ana',
        accounts: roster
      })
    ).toEqual({ provider: 'claude', id: 'acct_bo', email: 'bo@example.com' })
    expect(
      gameMemberAccountOf({
        agentType: 'claude',
        live: { known: true, accountId: 'acct_ana', customEndpoint: false },
        session: { accountId: null },
        pinnedAccountId: null,
        accounts: roster
      })
    ).toEqual({ provider: 'claude', id: 'acct_ana', email: 'ana@example.com' })
  })

  it('falls back to the worktree pin when the pane owner is unknown', () => {
    expect(
      gameMemberAccountOf({
        agentType: 'codex',
        live: { known: false, accountId: null, customEndpoint: false },
        pinnedAccountId: 'acct_ana',
        accounts: roster
      })
    ).toEqual({ provider: 'codex', id: 'acct_ana', email: 'ana@example.com' })
  })

  it('names none for an agent with no managed accounts, or an account no longer on the roster', () => {
    const base = { live: null, pinnedAccountId: 'acct_ana', accounts: roster }
    expect(gameMemberAccountOf({ ...base, agentType: 'gemini' })).toBeNull()
    expect(
      gameMemberAccountOf({ ...base, agentType: 'claude', pinnedAccountId: 'gone' })
    ).toBeNull()
    expect(gameMemberAccountOf({ ...base, agentType: 'claude', pinnedAccountId: null })).toBeNull()
  })
})

describe('isGameMemberOnGlobalLogin', () => {
  const globalPane = { known: true, accountId: null, customEndpoint: false }

  it('is true only for a pane Orca launched with no managed account and no worktree pin', () => {
    expect(
      isGameMemberOnGlobalLogin({ agentType: 'claude', live: globalPane, pinnedAccountId: null })
    ).toBe(true)
    expect(
      isGameMemberOnGlobalLogin({
        agentType: 'claude',
        live: { ...globalPane, accountId: 'acct_ana' },
        pinnedAccountId: null
      })
    ).toBe(false)
    expect(
      isGameMemberOnGlobalLogin({
        agentType: 'claude',
        live: globalPane,
        pinnedAccountId: 'acct_ana'
      })
    ).toBe(false)
  })

  it('is false when the running process reported a managed account', () => {
    expect(
      isGameMemberOnGlobalLogin({
        agentType: 'claude',
        live: globalPane,
        session: { accountId: 'acct_bo' },
        pinnedAccountId: null
      })
    ).toBe(false)
  })

  it('is false when the pane owner is unknown or the agent has no managed accounts', () => {
    expect(
      isGameMemberOnGlobalLogin({
        agentType: 'claude',
        live: { ...globalPane, known: false },
        pinnedAccountId: null
      })
    ).toBe(false)
    expect(
      isGameMemberOnGlobalLogin({ agentType: 'claude', live: null, pinnedAccountId: null })
    ).toBe(false)
    expect(
      isGameMemberOnGlobalLogin({ agentType: 'gemini', live: globalPane, pinnedAccountId: null })
    ).toBe(false)
  })
})
