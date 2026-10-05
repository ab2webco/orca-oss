import { describe, expect, it } from 'vitest'
import { AGENT_TYPE_MAX_LENGTH } from '../agent-status-types'
import { PLUGIN_EVENT_PAYLOAD_SCHEMAS, agentStatusChangedPayloadSchema } from './plugin-events'

const basePayload = {
  worktreeId: 'repo::/tmp/wt',
  paneKey: 'tab-1:leaf-1',
  state: 'done',
  receivedAt: 1_700_000_000_000
}

describe('agentStatusChangedPayloadSchema', () => {
  it('still accepts the original four-field payload', () => {
    expect(agentStatusChangedPayloadSchema.safeParse(basePayload).success).toBe(true)
    expect(
      agentStatusChangedPayloadSchema.safeParse({ ...basePayload, worktreeId: null }).success
    ).toBe(true)
  })

  it('passes agentType and sessionBoundary through to plugins', () => {
    const parsed = PLUGIN_EVENT_PAYLOAD_SCHEMAS['agent.status.changed'].safeParse({
      ...basePayload,
      agentType: 'claude',
      sessionBoundary: true
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ ...basePayload, agentType: 'claude', sessionBoundary: true })
  })

  it('rejects an agentType longer than the agent status bound', () => {
    expect(
      agentStatusChangedPayloadSchema.safeParse({
        ...basePayload,
        agentType: 'a'.repeat(AGENT_TYPE_MAX_LENGTH + 1)
      }).success
    ).toBe(false)
    expect(
      agentStatusChangedPayloadSchema.safeParse({
        ...basePayload,
        agentType: 'a'.repeat(AGENT_TYPE_MAX_LENGTH)
      }).success
    ).toBe(true)
  })

  it('rejects an empty agentType and a non-true sessionBoundary', () => {
    expect(
      agentStatusChangedPayloadSchema.safeParse({ ...basePayload, agentType: '' }).success
    ).toBe(false)
    expect(
      agentStatusChangedPayloadSchema.safeParse({ ...basePayload, sessionBoundary: 'yes' }).success
    ).toBe(false)
    expect(
      agentStatusChangedPayloadSchema.safeParse({ ...basePayload, sessionBoundary: false }).success
    ).toBe(false)
  })

  it('strips fields outside the bounded projection', () => {
    const parsed = agentStatusChangedPayloadSchema.safeParse({
      ...basePayload,
      prompt: 'secret prompt',
      lastAssistantMessage: 'secret output'
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(basePayload)
  })
})
