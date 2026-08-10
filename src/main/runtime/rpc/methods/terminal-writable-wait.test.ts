import { describe, expect, it } from 'vitest'
import { TERMINAL_METHODS } from './terminal'

describe('terminal.wait writable schema', () => {
  it('accepts writable as an observable wait condition', () => {
    const method = TERMINAL_METHODS.find((candidate) => candidate.name === 'terminal.wait')

    expect(
      method?.params?.safeParse({ terminal: 'term_starting', for: 'writable', timeoutMs: 1_000 })
        .success
    ).toBe(true)
  })
})
