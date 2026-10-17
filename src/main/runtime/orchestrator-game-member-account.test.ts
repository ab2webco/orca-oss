import { describe, expect, it } from 'vitest'
import { gameMemberAccountOf } from './orchestrator-game-member-account'

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
