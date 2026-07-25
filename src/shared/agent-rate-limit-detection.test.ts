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

  it('does not switch on narration about waiting for a limit to reset', () => {
    expect(
      detectAgentRateLimitOutput(
        'claude',
        'The retry helper will stop and wait for limit to reset before the next attempt.',
        createState()
      )
    ).toBe(false)
  })

  it('detects the interactive spend-limit menu that precedes the limit message', () => {
    // Why: this menu blocks the PTY waiting for input, so the switch used to fire
    // only after the user dismissed it by hand.
    expect(
      detectAgentRateLimitOutput(
        'claude',
        'What do you want to do?\n  1. Stop and wait for limit to reset\n  2. Ask your admin for more usage',
        createState()
      )
    ).toBe(true)
  })

  it('detects the spend-limit menu when its options render in reverse order', () => {
    expect(
      detectAgentRateLimitOutput(
        'claude',
        'Ask your admin for more usage\nStop and wait for the limit to reset',
        createState()
      )
    ).toBe(true)
  })

  it('detects the spend-limit menu split across PTY chunks', () => {
    const state = createState()
    expect(detectAgentRateLimitOutput('claude', '1. Stop and wait for limit to reset', state)).toBe(
      false
    )
    // The tail must carry the first option until the second one arrives.
    expect(
      detectAgentRateLimitOutput('claude', '\n  2. Ask your admin for more usage', state)
    ).toBe(true)
  })

  it('does not treat one menu option alone as an account limit', () => {
    expect(
      detectAgentRateLimitOutput(
        'claude',
        'If the build fails, ask your admin for more usage of the CI runners',
        createState()
      )
    ).toBe(false)
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

  it('detects z.ai/GLM weekly-monthly quota exhaustion on a custom-endpoint Claude session', () => {
    expect(
      detectAgentRateLimitOutput(
        'claude',
        'API Error: Request rejected (429) · [1310][Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-07-28 05:10:38]',
        createState()
      )
    ).toBe(true)
  })

  it('does not treat a transient z.ai gateway 429 (no exhaustion) as an account limit', () => {
    expect(
      detectAgentRateLimitOutput(
        'claude',
        'API Error: Request rejected (429) · upstream temporarily unavailable, retrying',
        createState()
      )
    ).toBe(false)
  })
})
