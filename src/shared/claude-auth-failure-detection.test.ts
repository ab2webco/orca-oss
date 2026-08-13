import { describe, expect, it } from 'vitest'
import {
  bindClaudeAuthFailureDetectionToPty,
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
    expect(detectClaudeAuthFailureOutput('Login expired · please run ', state, NOW)).toBe(false)
    expect(detectClaudeAuthFailureOutput('/login now', state, NOW)).toBe(true)
  })

  it('ignores quoted or logged auth phrases that are not the provider rejection banner', () => {
    const quoted = createClaudeAuthFailureDetectionState()
    const logged = createClaudeAuthFailureDetectionState()

    expect(detectClaudeAuthFailureOutput('const message = "Login expired"\n', quoted, NOW)).toBe(
      false
    )
    expect(
      detectClaudeAuthFailureOutput(
        '[debug] provider response: authentication_error while replaying fixture\n',
        logged,
        NOW
      )
    ).toBe(false)
  })

  it('ignores ordinary output that merely mentions logging in', () => {
    const state = createClaudeAuthFailureDetectionState()
    expect(
      detectClaudeAuthFailureOutput('added a login form to routes/login.ts\n', state, NOW)
    ).toBe(false)
  })

  it('does not re-fire while the TUI keeps redrawing the same banner', () => {
    const state = createClaudeAuthFailureDetectionState()
    const banner = 'Login expired · Please run /login\n'
    expect(detectClaudeAuthFailureOutput(banner, state, NOW)).toBe(true)
    expect(detectClaudeAuthFailureOutput(banner, state, NOW + 5_000)).toBe(false)
  })

  it('fires again once the cooldown has passed', () => {
    const state = createClaudeAuthFailureDetectionState()
    const banner = 'Login expired · Please run /login\n'
    expect(detectClaudeAuthFailureOutput(banner, state, NOW)).toBe(true)
    expect(detectClaudeAuthFailureOutput(banner, state, NOW + 61_000)).toBe(true)
  })

  it('stamps when the pane started watching so a later re-authentication can outrank it', () => {
    const state = createClaudeAuthFailureDetectionState()

    bindClaudeAuthFailureDetectionToPty(state, 'pty-1', NOW)
    bindClaudeAuthFailureDetectionToPty(state, 'pty-1', NOW + 5_000)

    expect(state.boundAt).toBe(NOW)

    bindClaudeAuthFailureDetectionToPty(state, 'pty-2', NOW + 9_000)

    expect(state.boundAt).toBe(NOW + 9_000)
  })

  it('drops split output and cooldown when the pane binds a different PTY', () => {
    const state = createClaudeAuthFailureDetectionState()
    bindClaudeAuthFailureDetectionToPty(state, 'pty-old', NOW)
    expect(detectClaudeAuthFailureOutput('Login expired · Please run ', state, NOW)).toBe(false)

    bindClaudeAuthFailureDetectionToPty(state, 'pty-new', NOW + 1)

    expect(detectClaudeAuthFailureOutput('/login', state, NOW + 1)).toBe(false)
    expect(
      detectClaudeAuthFailureOutput('\nLogin expired · Please run /login', state, NOW + 2)
    ).toBe(true)
  })
})
