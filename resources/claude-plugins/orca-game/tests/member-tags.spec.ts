import { describe, expect, it } from 'vitest'

import { parseGameState } from '../hooks/game-state'
import { setGameLocale } from '../hooks/game-strings'
import { agentTagOf, limitTagOf } from '../hooks/member-tags'
import { memberPhaseOf } from '../hooks/state-report'
import type { GameMemberAccount } from '../types'

const NOW = 1_000_000
const MINUTE = 60_000

const stateWith = (agent: Record<string, unknown>) =>
  JSON.stringify({
    agents: [
      {
        paneKey: 'tab-1:m',
        displayName: 'CIN-5',
        agentType: 'codex',
        state: 'idle',
        toolName: null,
        isLeader: false,
        isMember: true,
        ...agent
      }
    ]
  })

describe('member limit', () => {
  it("keeps a member's usage limit and drops a malformed one", () => {
    expect(parseGameState(stateWith({ limit: { resetsAt: NOW } }))?.agents[0]?.limit).toEqual({
      resetsAt: NOW
    })
    expect(parseGameState(stateWith({ limit: { resetsAt: null } }))?.agents[0]?.limit).toEqual({
      resetsAt: null
    })
    expect(
      parseGameState(stateWith({ limit: { resetsAt: null, loggedOut: true } }))?.agents[0]?.limit
    ).toEqual({ resetsAt: null, loggedOut: true })
    expect(parseGameState(stateWith({ limit: 'soon' }))?.agents[0]?.limit).toBeUndefined()
    expect(parseGameState(stateWith({}))?.agents[0]?.limit).toBeUndefined()
  })

  it('says a member is limited and when it is back, in the session language', () => {
    expect(limitTagOf({ resetsAt: NOW + 90 * MINUTE }, NOW)).toBe('limited · back in 1h 30m')
    expect(limitTagOf({ resetsAt: null }, NOW)).toBe('limited')
    setGameLocale('es')
    try {
      expect(limitTagOf({ resetsAt: NOW + 45 * MINUTE }, NOW)).toBe('limitado · vuelve en 45m')
      expect(limitTagOf({ resetsAt: null }, NOW)).toBe('limitado')
      expect(limitTagOf({ resetsAt: null, loggedOut: true }, NOW)).toBe(
        'sesión cerrada · /login en su panel'
      )
    } finally {
      setGameLocale('en')
    }
  })

  // Why (ORCA-907): a logged-out member waits on a person, not on a reset.
  it('says a member logged out, and shows it as needing you', () => {
    expect(limitTagOf({ resetsAt: null, loggedOut: true }, NOW)).toBe(
      'logged out · /login in its pane'
    )
    const agent = parseGameState(stateWith({ limit: { resetsAt: null, loggedOut: true } }))
      ?.agents[0]
    expect(agent && memberPhaseOf(agent)).toBe('needs-you')
  })
})

describe('member agent and account tag', () => {
  const account: GameMemberAccount = {
    provider: 'codex',
    id: 'acct_ana',
    email: 'ana.lopez@example.com'
  }

  it("keeps a member's account and drops a malformed one", () => {
    expect(parseGameState(stateWith({ account }))?.agents[0]?.account).toEqual(account)
    expect(
      parseGameState(stateWith({ account: { provider: 'codex', id: 'x' } }))?.agents[0]?.account
    ).toBeUndefined()
  })

  it('names the agent and the account, never the whole email, shorter as the room shrinks', () => {
    expect(agentTagOf({ agentType: 'codex', account }, 40)).toBe('codex · ana.lopez@…')
    expect(agentTagOf({ agentType: 'codex', account }, 14)).toBe('codex · ana…@…')
    expect(agentTagOf({ agentType: 'codex', account }, 8)).toBe('codex')
    expect(agentTagOf({ agentType: 'gemini' }, 40)).toBe('gemini')
  })
})

describe('member host tag (ORCA-824)', () => {
  // Why: a member whose terminal is gone on its host must not read as a silent host (ORCA-790).
  it('keeps that the host answered and the member is gone', () => {
    expect(
      parseGameState(stateWith({ remote: { host: 'imac', stateKnown: false, gone: true } }))
        ?.agents[0]?.remote
    ).toEqual({ host: 'imac', stateKnown: false, gone: true })
  })

  it('says a gone member is gone from its host, in the session language', () => {
    const gone = { host: 'imac', stateKnown: false, gone: true as const }
    setGameLocale('en')
    expect(agentTagOf({ agentType: '', remote: gone }, 40)).toBe('gone from imac')
    expect(agentTagOf({ agentType: '', remote: gone }, 6)).toBe('imac ✕')
    setGameLocale('es')
    expect(agentTagOf({ agentType: '', remote: gone }, 40)).toBe('ya no está en imac')
    setGameLocale('en')
  })

  // Why: a finished member's terminal closing on an answering host is not news (ORCA-854).
  it('names the host of a finished member whose terminal closed as for a live one', () => {
    const closed = { host: 'imac', stateKnown: true, gone: true as const }
    setGameLocale('en')
    expect(agentTagOf({ agentType: '', state: 'done', remote: closed }, 40)).toBe('on imac')
    expect(agentTagOf({ agentType: '', state: 'done', remote: closed }, 6)).toBe('imac')
    expect(agentTagOf({ agentType: '', state: 'idle', remote: closed }, 40)).toBe('gone from imac')
  })

  it('keeps the paired host a member runs on and drops a malformed one', () => {
    expect(
      parseGameState(stateWith({ remote: { host: 'imac', stateKnown: false } }))?.agents[0]?.remote
    ).toEqual({ host: 'imac', stateKnown: false })
    expect(parseGameState(stateWith({ remote: { host: '' } }))?.agents[0]?.remote).toBeUndefined()
  })

  it('names the host beside the agent, and says when it does not answer, in the session language', () => {
    setGameLocale('en')
    expect(agentTagOf({ agentType: '', remote: { host: 'imac', stateKnown: true } }, 40)).toBe(
      'on imac'
    )
    expect(
      agentTagOf({ agentType: 'claude', remote: { host: 'imac', stateKnown: false } }, 40)
    ).toBe('claude · imac not answering')
    // Why: at 320 the long tag ellipsizes to `imac no…` and loses what it says.
    expect(agentTagOf({ agentType: '', remote: { host: 'imac', stateKnown: false } }, 9)).toBe(
      'imac ?'
    )
    expect(agentTagOf({ agentType: '', remote: { host: 'imac', stateKnown: true } }, 6)).toBe(
      'imac'
    )
    setGameLocale('es')
    expect(agentTagOf({ agentType: '', remote: { host: 'imac', stateKnown: true } }, 40)).toBe(
      'en imac'
    )
    setGameLocale('en')
  })
})
