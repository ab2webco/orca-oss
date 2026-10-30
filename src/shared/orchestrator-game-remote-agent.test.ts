import { describe, expect, it } from 'vitest'
import type { AgentStatusIpcPayload } from './agent-status-types'
import { parseRemoteMemberAgent, remoteMemberAgentOf } from './orchestrator-game-remote-agent'

const entry = (overrides: Partial<AgentStatusIpcPayload> = {}): AgentStatusIpcPayload => ({
  paneKey: 'tab:817',
  state: 'working',
  prompt: 'install the Android SDK',
  agentType: 'claude',
  connectionId: null,
  receivedAt: 1_000,
  stateStartedAt: 900,
  ...overrides
})

describe("a remote member's relayed agent reading (ORCA-837)", () => {
  it("reads the pane's latest hook event", () => {
    expect(remoteMemberAgentOf([entry({ paneKey: 'other' }), entry()], 'tab:817')).toEqual({
      state: 'working',
      agentType: 'claude',
      updatedAt: 1_000
    })
  })

  it('reads nothing for an unknown pane or a reading only restored from disk', () => {
    expect(remoteMemberAgentOf([entry()], null)).toBeNull()
    expect(remoteMemberAgentOf([entry()], 'tab:other')).toBeNull()
    expect(remoteMemberAgentOf([entry({ restoredUnconfirmed: true })], 'tab:817')).toBeNull()
  })

  it('accepts what a host relayed and drops what it cannot trust', () => {
    expect(
      parseRemoteMemberAgent({
        state: 'done',
        agentType: 'codex',
        updatedAt: 5,
        limit: { resetsAt: null }
      })
    ).toEqual({
      state: 'done',
      agentType: 'codex',
      updatedAt: 5,
      limit: { resetsAt: null }
    })
    expect(parseRemoteMemberAgent({ state: 'blocked', updatedAt: 5, limit: 'soon' })).toEqual({
      state: 'blocked',
      agentType: null,
      updatedAt: 5
    })
    expect(parseRemoteMemberAgent(undefined)).toBeNull()
  })

  it("keeps a relayed account's provider and email, never an id (ORCA-798)", () => {
    const relayed = (account: unknown) =>
      parseRemoteMemberAgent({ state: 'working', updatedAt: 5, account })?.account
    expect(relayed({ provider: 'claude', email: 'ana@koombea.com', id: 'imac-ana' })).toEqual({
      provider: 'claude',
      email: 'ana@koombea.com'
    })
    expect(relayed({ provider: 'gemini', email: 'ana@koombea.com' })).toBeUndefined()
    expect(relayed({ provider: 'codex' })).toBeUndefined()
    expect(parseRemoteMemberAgent({ state: 'sleeping', updatedAt: 5 })).toBeNull()
    expect(parseRemoteMemberAgent({ state: 'working', updatedAt: Number.NaN })).toBeNull()
  })
})
