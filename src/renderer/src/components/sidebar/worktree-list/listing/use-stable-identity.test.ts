// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useStableIdentity } from './use-stable-identity'

const sameSize = (left: Set<string>, right: Set<string>): boolean => left.size === right.size

describe('useStableIdentity', () => {
  it('keeps the first identity while each next value is equal', () => {
    const first = new Set(['a'])
    const { result, rerender } = renderHook(({ value }) => useStableIdentity(value, sameSize), {
      initialProps: { value: first }
    })
    rerender({ value: new Set(['b']) })
    expect(result.current).toBe(first)
  })

  it('takes the next identity once the value differs, and keeps it after', () => {
    const { result, rerender } = renderHook(({ value }) => useStableIdentity(value, sameSize), {
      initialProps: { value: new Set(['a']) }
    })
    const next = new Set(['a', 'b'])
    rerender({ value: next })
    expect(result.current).toBe(next)
    rerender({ value: new Set(['c', 'd']) })
    expect(result.current).toBe(next)
  })
})
