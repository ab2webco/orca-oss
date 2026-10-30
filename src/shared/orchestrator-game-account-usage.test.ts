import { describe, expect, it } from 'vitest'
import { gameAccountUsagesOf } from './orchestrator-game-account-usage'
import type { AccountListEntry } from './managed-account-list-entries'
import type { GameAgent } from './orchestrator-game-state'

const entry = (id: string): AccountListEntry =>
  ({ provider: 'claude', id, email: `${id}@example.com`, runtime: 'host', quota: null }) as never

const member = (ticket: string, accountId: string, limit?: GameAgent['limit']): GameAgent =>
  ({
    paneKey: ticket,
    displayName: ticket,
    agentType: 'claude',
    state: 'idle',
    isLeader: false,
    isMember: true,
    account: { provider: 'claude', id: accountId, email: `${accountId}@example.com` },
    ...(limit ? { limit } : {})
  }) as GameAgent

describe('gameAccountUsagesOf', () => {
  it('marks an account stopped when one of its members stopped on a limit, with the latest reset', () => {
    const usages = gameAccountUsagesOf({
      entries: [entry('ana'), entry('cy')],
      provider: 'claude',
      agents: [
        member('CIN-1', 'ana', { resetsAt: 5 }),
        member('CIN-2', 'ana', { resetsAt: 9 }),
        member('CIN-3', 'cy')
      ]
    })
    expect(usages.map((one) => [one.email, one.stopped])).toEqual([
      ['ana@example.com', { resetsAt: 9 }],
      ['cy@example.com', undefined]
    ])
  })

  it('keeps only the accounts the project allows, by email or id', () => {
    const usages = gameAccountUsagesOf({
      entries: [entry('ana'), entry('cy'), entry('dee')],
      provider: 'claude',
      agents: [],
      allowed: ['ANA@example.com', 'dee']
    })
    expect(usages.map((one) => one.id)).toEqual(['ana', 'dee'])
  })
})
