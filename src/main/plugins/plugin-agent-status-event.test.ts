import { describe, expect, it } from 'vitest'
import { AGENT_TYPE_MAX_LENGTH } from '../../shared/agent-status-types'
import { agentStatusChangedPayloadSchema } from '../../shared/plugins/plugin-events'
import {
  projectAgentStatusChangedEvent,
  type AgentStatusEventSource
} from './plugin-agent-status-event'

function source(overrides: Partial<AgentStatusEventSource> = {}): AgentStatusEventSource {
  return {
    worktreeId: 'repo::/tmp/wt',
    paneKey: 'tab-1:leaf-1',
    receivedAt: 1_700_000_000_000,
    payload: { state: 'done' },
    ...overrides
  }
}

describe('projectAgentStatusChangedEvent', () => {
  it('keeps the original four fields and omits the new ones when the source has none', () => {
    expect(projectAgentStatusChangedEvent(source({ worktreeId: undefined }))).toStrictEqual({
      worktreeId: null,
      paneKey: 'tab-1:leaf-1',
      state: 'done',
      receivedAt: 1_700_000_000_000
    })
  })

  it('carries the agent type when the hook reported one', () => {
    expect(
      projectAgentStatusChangedEvent(source({ payload: { state: 'working', agentType: 'codex' } }))
    ).toStrictEqual({
      worktreeId: 'repo::/tmp/wt',
      paneKey: 'tab-1:leaf-1',
      state: 'working',
      receivedAt: 1_700_000_000_000,
      agentType: 'codex'
    })
  })

  it("omits an agent type that carries no identity ('unknown', empty) or exceeds the bound", () => {
    for (const agentType of ['unknown', '', '   ', 'a'.repeat(AGENT_TYPE_MAX_LENGTH + 1)]) {
      expect(
        projectAgentStatusChangedEvent(source({ payload: { state: 'done', agentType } }))
      ).not.toHaveProperty('agentType')
    }
  })

  it('marks a session-boundary done so plugins can skip it', () => {
    expect(
      projectAgentStatusChangedEvent(
        source({ payload: { state: 'done', agentType: 'claude', sessionBoundary: true } })
      )
    ).toMatchObject({ state: 'done', agentType: 'claude', sessionBoundary: true })
  })

  it('omits sessionBoundary on a completed turn and on any non-done state', () => {
    expect(
      projectAgentStatusChangedEvent(source({ payload: { state: 'done', sessionBoundary: false } }))
    ).not.toHaveProperty('sessionBoundary')
    expect(
      projectAgentStatusChangedEvent(source({ payload: { state: 'done' } }))
    ).not.toHaveProperty('sessionBoundary')
    expect(
      projectAgentStatusChangedEvent(
        source({ payload: { state: 'working', sessionBoundary: true } })
      )
    ).not.toHaveProperty('sessionBoundary')
  })

  it('always produces a payload the plugin event schema accepts', () => {
    const sources: AgentStatusEventSource[] = [
      source(),
      source({ worktreeId: undefined }),
      source({ payload: { state: 'done', agentType: 'claude', sessionBoundary: true } }),
      source({ payload: { state: 'blocked', agentType: 'x'.repeat(500), sessionBoundary: true } })
    ]
    for (const input of sources) {
      expect(
        agentStatusChangedPayloadSchema.safeParse(projectAgentStatusChangedEvent(input)).success
      ).toBe(true)
    }
  })
})
