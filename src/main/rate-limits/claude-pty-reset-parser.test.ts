import { describe, expect, it } from 'vitest'
import { extractClaudePtyResetMetadata } from './claude-pty-reset-parser'

const isLabel = (line: string): boolean => line.startsWith('Current session')

describe('extractClaudePtyResetMetadata relative resets', () => {
  it('parses a relative reset with mixed units', () => {
    const before = Date.now()
    const { resetsAt } = extractClaudePtyResetMetadata(
      ['Current session', 'Resets in 1d 2h 3m'],
      isLabel,
      () => false
    )
    const expected = ((24 + 2) * 60 + 3) * 60_000
    expect(resetsAt! - before).toBeGreaterThanOrEqual(expected)
    expect(resetsAt! - before).toBeLessThan(expected + 5_000)
  })

  it('rejects a long run of unit tokens in linear time', () => {
    // Why: the old `(?:\s*\d+\s*unit\s*)+` split each space two ways; 22 tokens took ~1 s.
    const startedAt = performance.now()
    extractClaudePtyResetMetadata(
      ['Current session', `Resets in 0d${' 0d'.repeat(26)}!`],
      isLabel,
      () => false
    )
    expect(performance.now() - startedAt).toBeLessThan(1000)
  })
})
