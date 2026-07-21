import { describe, expect, it } from 'vitest'
import {
  detectAgentRateLimitOutput,
  type AgentRateLimitDetectionState
} from './agent-rate-limit-detection'

function createState(): AgentRateLimitDetectionState {
  return { tail: '' }
}

describe('agent rate limit detection', () => {
  it('detects split Codex account limit output', () => {
    const state = createState()

    expect(detectAgentRateLimitOutput('codex', 'Error: rate ', state)).toBe(false)
    expect(detectAgentRateLimitOutput('codex', 'limit exceeded. Try later.', state)).toBe(true)
  })

  it('detects ANSI-wrapped Claude usage limit output', () => {
    expect(
      detectAgentRateLimitOutput(
        'claude',
        '\x1b[31mYou have reached your weekly usage limit\x1b[0m',
        createState()
      )
    ).toBe(true)
  })

  it('detects Claude org monthly spend limit output', () => {
    expect(
      detectAgentRateLimitOutput(
        'claude',
        "You've hit your org's monthly spend limit · run /usage-credits to ask your admin for a higher limit",
        createState()
      )
    ).toBe(true)
  })

  it('detects the Claude /usage-credits hint even when the limit phrase is truncated', () => {
    expect(
      detectAgentRateLimitOutput('claude', 'run /usage-credits to ask your admin', createState())
    ).toBe(true)
  })

  it('does not treat benign mentions of the /usage-credits command as account limits', () => {
    expect(
      detectAgentRateLimitOutput(
        'claude',
        'run /usage-credits to test the CLI command locally',
        createState()
      )
    ).toBe(false)
  })

  it('does not treat business-logic narration about exceeded credit limits as account limits', () => {
    expect(
      detectAgentRateLimitOutput(
        'claude',
        'when a customer has exceeded their credit limit, deny the transaction',
        createState()
      )
    ).toBe(false)
  })

  it('does not treat ordinary domain talk about credit or billing limits as account limits', () => {
    expect(
      detectAgentRateLimitOutput(
        'claude',
        "Let's update the credit limit validation in the billing module.",
        createState()
      )
    ).toBe(false)
  })

  it('does not treat context window limits as account limits', () => {
    expect(
      detectAgentRateLimitOutput(
        'codex',
        'The conversation is too long for the current context window.',
        createState()
      )
    ).toBe(false)
  })
})
