import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import {
  MAX_AGENT_SESSION_LOG_PANES,
  normalizeAgentSessionLogIdentityRequest,
  normalizeAgentSessionLogPaneKeys,
  readAgentSessionLogPanes
} from './agent-session-log-panes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))

const readAgentSessionLogState = vi.hoisted(() => vi.fn())
vi.mock('../native-chat/session-log-agent-state', () => ({ readAgentSessionLogState }))

function paneKey(index: number): string {
  return `tab-${index}:00000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`
}

function status(overrides: Partial<AgentStatusIpcPayload>): AgentStatusIpcPayload {
  return {
    paneKey: paneKey(1),
    state: 'working',
    receivedAt: 10,
    stateStartedAt: 5,
    agentType: 'claude',
    providerSession: { key: 'session_id', id: 'session-1' },
    ...overrides
  } as AgentStatusIpcPayload
}

describe('normalizeAgentSessionLogPaneKeys', () => {
  it('drops non-arrays, malformed keys and duplicates', () => {
    expect(normalizeAgentSessionLogPaneKeys('nope')).toEqual([])
    expect(
      normalizeAgentSessionLogPaneKeys([paneKey(1), paneKey(1), 'not-a-pane-key', 7, null])
    ).toEqual([paneKey(1)])
  })

  it('caps the batch so one call cannot fan out unbounded transcript scans', () => {
    const requested = Array.from({ length: MAX_AGENT_SESSION_LOG_PANES + 20 }, (_, index) =>
      `tab-${index}:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    )
    expect(normalizeAgentSessionLogPaneKeys(requested)).toHaveLength(
      MAX_AGENT_SESSION_LOG_PANES
    )
  })
})

describe('readAgentSessionLogPanes', () => {
  beforeEach(() => {
    readAgentSessionLogState.mockReset()
  })

  it('reads the newest hook identity for each pane and keeps request order', async () => {
    readAgentSessionLogState.mockImplementation(async (args: { sessionId: string }) => ({
      read: true,
      state: 'working',
      lastTurnAtMs: 1,
      queuedInput: { supported: true, pending: 0 },
      unparsedRecords: 0,
      activity: { lastAssistantText: args.sessionId, pendingToolName: null, atMs: 1, textBeyondScan: false }
    }))
    const readings = await readAgentSessionLogPanes([paneKey(1), paneKey(2)], [
      status({ paneKey: paneKey(1), receivedAt: 10, providerSession: { key: 'session_id', id: 'old' } }),
      status({ paneKey: paneKey(1), receivedAt: 20, providerSession: { key: 'session_id', id: 'newest' } }),
      status({ paneKey: paneKey(2), receivedAt: 5, providerSession: { key: 'session_id', id: 'other' } })
    ])
    expect(readings.map((reading) => reading.paneKey)).toEqual([paneKey(1), paneKey(2)])
    expect(readings[0].sessionId).toBe('newest')
    expect(readings[1].sessionId).toBe('other')
  })

  it('degrades visibly when no hook row has named the pane\'s session yet', async () => {
    const [reading] = await readAgentSessionLogPanes([paneKey(3)], [])
    expect(reading).toEqual({
      paneKey: paneKey(3),
      agent: null,
      sessionId: null,
      session: { read: false, reason: 'agent-session-unknown' }
    })
    expect(readAgentSessionLogState).not.toHaveBeenCalled()
  })

  it('always asks for activity, since a cell must say what the agent is doing', async () => {
    readAgentSessionLogState.mockResolvedValue({ read: false, reason: 'session-log-missing' })
    await readAgentSessionLogPanes([paneKey(1)], [status({})])
    expect(readAgentSessionLogState).toHaveBeenCalledWith(
      expect.objectContaining({ includeActivity: true })
    )
  })
})

describe('normalizeAgentSessionLogIdentityRequest', () => {
  it('accepts a resumable agent with a valid provider session', () => {
    expect(
      normalizeAgentSessionLogIdentityRequest({
        agent: 'codex',
        providerSession: { key: 'session_id', id: 'sess-1' }
      })
    ).toEqual({
      agent: 'codex',
      providerSession: { key: 'session_id', id: 'sess-1' }
    })
  })

  it('rejects a non-resumable or missing agent', () => {
    expect(
      normalizeAgentSessionLogIdentityRequest({
        agent: 'not-a-real-agent',
        providerSession: { key: 'session_id', id: 'sess-1' }
      })
    ).toBeNull()
    expect(
      normalizeAgentSessionLogIdentityRequest({
        providerSession: { key: 'session_id', id: 'sess-1' }
      })
    ).toBeNull()
  })

  it('rejects a malformed or missing provider session', () => {
    expect(normalizeAgentSessionLogIdentityRequest({ agent: 'codex' })).toBeNull()
    expect(
      normalizeAgentSessionLogIdentityRequest({ agent: 'codex', providerSession: { id: 'x' } })
    ).toBeNull()
  })

  it('rejects non-object and null requests', () => {
    expect(normalizeAgentSessionLogIdentityRequest(null)).toBeNull()
    expect(normalizeAgentSessionLogIdentityRequest('codex')).toBeNull()
    expect(normalizeAgentSessionLogIdentityRequest(undefined)).toBeNull()
  })
})
