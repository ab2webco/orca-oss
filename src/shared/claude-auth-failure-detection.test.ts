import { describe, expect, it } from 'vitest'
import {
  createClaudeAuthFailureDetectionState,
  detectClaudeAuthFailureOutput
} from './claude-auth-failure-detection'

const NOW = 1_760_000_000_000

describe('detectClaudeAuthFailureOutput', () => {
  it('detects the CLI auth-expired banner through ANSI decoration', () => {
    const state = createClaudeAuthFailureDetectionState()
    const chunk = '[31m⎿  Login expired[0m · Please run [1m/login[0m\r\n'
    expect(detectClaudeAuthFailureOutput(chunk, state, NOW)).toBe(true)
  })

  it('detects a phrase split across two PTY chunks', () => {
    const state = createClaudeAuthFailureDetectionState()
    expect(detectClaudeAuthFailureOutput('please run ', state, NOW)).toBe(false)
    expect(detectClaudeAuthFailureOutput('/login now', state, NOW)).toBe(true)
  })

  it('ignores ordinary output that merely mentions logging in', () => {
    const state = createClaudeAuthFailureDetectionState()
    expect(
      detectClaudeAuthFailureOutput('added a login form to routes/login.ts\n', state, NOW)
    ).toBe(false)
  })

  it('does not re-fire while the TUI keeps redrawing the same banner', () => {
    const state = createClaudeAuthFailureDetectionState()
    expect(detectClaudeAuthFailureOutput('Login expired\n', state, NOW)).toBe(true)
    expect(detectClaudeAuthFailureOutput('Login expired\n', state, NOW + 5_000)).toBe(false)
  })

  it('fires again once the cooldown has passed', () => {
    const state = createClaudeAuthFailureDetectionState()
    expect(detectClaudeAuthFailureOutput('Login expired\n', state, NOW)).toBe(true)
    expect(detectClaudeAuthFailureOutput('Login expired\n', state, NOW + 61_000)).toBe(true)
  })
})
