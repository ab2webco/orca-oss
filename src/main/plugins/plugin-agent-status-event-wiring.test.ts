import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer, _internals } from '../agent-hooks/server'
import { PANE } from '../agent-hooks/server.test-fixtures'
import { agentStatusChangedPayloadSchema } from '../../shared/plugins/plugin-events'
import { wirePluginAgentStatusEvents } from './plugin-agent-status-event'

const { getCohortAtEmitMock, trackMock } = vi.hoisted(() => ({
  getCohortAtEmitMock: vi.fn(),
  trackMock: vi.fn()
}))

vi.mock('../telemetry/client', () => ({
  track: trackMock
}))

vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: getCohortAtEmitMock
}))

beforeEach(() => {
  _internals.resetCachesForTests()
  getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function ingestDone(server: AgentHookServer): void {
  server.ingestRemote(
    {
      paneKey: PANE,
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      payload: {
        state: 'done',
        prompt: 'secret prompt',
        agentType: 'claude',
        sessionBoundary: true,
        lastAssistantMessage: 'secret output'
      }
    },
    'conn-1'
  )
}

describe('wirePluginAgentStatusEvents', () => {
  it('emits the projected payload, agentType and sessionBoundary included, for a live hook', () => {
    const server = new AgentHookServer()
    const emit = vi.fn()
    wirePluginAgentStatusEvents(server, emit)

    ingestDone(server)

    expect(emit).toHaveBeenCalledTimes(1)
    const [event, payload] = emit.mock.calls[0]
    expect(event).toBe('agent.status.changed')
    expect(payload).toStrictEqual({
      worktreeId: 'wt-1',
      paneKey: PANE,
      state: 'done',
      receivedAt: expect.any(Number),
      agentType: 'claude',
      sessionBoundary: true
    })
    expect(agentStatusChangedPayloadSchema.safeParse(payload).success).toBe(true)
  })

  it('stops emitting once the returned unsubscribe runs', () => {
    const server = new AgentHookServer()
    const emit = vi.fn()
    const unsubscribe = wirePluginAgentStatusEvents(server, emit)

    unsubscribe()
    ingestDone(server)

    expect(emit).not.toHaveBeenCalled()
  })
})
