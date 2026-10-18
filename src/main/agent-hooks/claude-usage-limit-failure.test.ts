import { describe, expect, it } from 'vitest'
import { isClaudeUsageLimitFailure } from './claude-usage-limit-failure'

describe('isClaudeUsageLimitFailure', () => {
  it('recognizes the limit message in the error or the captured output', () => {
    expect(isClaudeUsageLimitFailure("You've hit your limit · resets 3pm", null)).toBe(true)
    expect(
      isClaudeUsageLimitFailure('failed', {
        label: 'claude',
        exitCode: 1,
        stdout: '',
        stderr: 'Claude usage limit reached'
      })
    ).toBe(true)
  })

  it('does not treat other failures as a limit', () => {
    expect(isClaudeUsageLimitFailure('binary missing', null)).toBe(false)
  })
})
