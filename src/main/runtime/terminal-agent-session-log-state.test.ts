import { describe, expect, it } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import {
  readTerminalAgentSessionLogState,
  selectAgentSessionIdentity
} from './terminal-agent-session-log-state'

function statusRow(overrides: Partial<AgentStatusIpcPayload>): AgentStatusIpcPayload {
  return {
    state: 'working',
    prompt: '',
    paneKey: 'pane-1',
    terminalHandle: 'term-1',
    connectionId: null,
    receivedAt: 1_000,
    stateStartedAt: 1_000,
    ...overrides
  }
}

describe('selectAgentSessionIdentity', () => {
  it('takes the newest row that carries both an agent and a session id', () => {
    const identity = selectAgentSessionIdentity('term-1', 'pane-1', [
      statusRow({
        receivedAt: 1_000,
        agentType: 'claude',
        providerSession: { key: 'session_id', id: 'older' }
      }),
      statusRow({
        receivedAt: 2_000,
        agentType: 'codex',
        providerSession: { key: 'session_id', id: 'newer' }
      })
    ])
    expect(identity).toEqual({
      agent: 'codex',
      providerSession: { key: 'session_id', id: 'newer' }
    })
  })

  // ORCA-191: a pane whose agent never got identified must not borrow another's.
  it('ignores a newer row that never named the agent', () => {
    const identity = selectAgentSessionIdentity('term-1', 'pane-1', [
      statusRow({
        receivedAt: 1_000,
        agentType: 'claude',
        providerSession: { key: 'session_id', id: 'named' }
      }),
      statusRow({ receivedAt: 5_000, providerSession: { key: 'session_id', id: 'anonymous' } })
    ])
    expect(identity?.providerSession.id).toBe('named')
  })

  it('ignores rows belonging to another pane and handle', () => {
    const identity = selectAgentSessionIdentity('term-1', 'pane-1', [
      statusRow({
        paneKey: 'pane-2',
        terminalHandle: 'term-2',
        agentType: 'claude',
        providerSession: { key: 'session_id', id: 'other' }
      })
    ])
    expect(identity).toBeNull()
  })

  it('returns null when no row carries a session id', () => {
    expect(
      selectAgentSessionIdentity('term-1', 'pane-1', [statusRow({ agentType: 'claude' })])
    ).toBeNull()
  })
})

describe('readTerminalAgentSessionLogState', () => {
  it('reports an unidentified pane distinctly from any real state', async () => {
    const reading = await readTerminalAgentSessionLogState('term-1', null)
    expect(reading).toEqual({
      handle: 'term-1',
      agent: null,
      sessionId: null,
      session: { read: false, reason: 'agent-session-unknown' }
    })
  })
})
