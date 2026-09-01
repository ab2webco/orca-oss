import { describe, expect, it } from 'vitest'

// The gate's whole job is counting cases in a source file, so that is what is worth
// pinning — the git plumbing around it is exercised by running it against real history.
const CASE = /^\s*(?:it|test)(?:\.\w+)?\s*\(/gm
const countCases = (source) => (source.match(CASE) ?? []).length

describe('test case deletion gate', () => {
  it('counts the case forms this repo actually uses', () => {
    expect(
      countCases(`
        it('plain', () => {})
        test('alias', () => {})
        it.each([1])('parameterised %i', () => {})
        it.skip('skipped still counts as declared', () => {})
      `)
    ).toBe(4)
  })

  // Why: a describe or a call to something merely named `submit(` must not inflate the
  // count, or a real deletion could hide behind an unrelated line being added.
  it('does not count describes or lookalike calls', () => {
    expect(
      countCases(`
        describe('group', () => {})
        const waiting = submit('x')
        // it('commented out', () => {})
      `)
    ).toBe(0)
  })

  it('sees the removal it exists to catch', () => {
    const before = "it('a', () => {})\nit('b', () => {})"
    const after = "it('a', () => {})"
    expect(countCases(after)).toBeLessThan(countCases(before))
  })
})
