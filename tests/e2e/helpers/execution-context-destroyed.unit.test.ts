import { describe, expect, it } from 'vitest'
import { isExecutionContextDestroyedError } from './execution-context-destroyed'

describe('isExecutionContextDestroyedError', () => {
  it('matches the exact Playwright message', () => {
    const error = new Error(
      'page.evaluate: Execution context was destroyed, most likely because of a navigation.'
    )
    expect(isExecutionContextDestroyedError(error)).toBe(true)
  })

  it('does not match an unrelated Error', () => {
    const error = new Error('window.__store is not available')
    expect(isExecutionContextDestroyedError(error)).toBe(false)
  })

  it('does not match a non-Error thrown value', () => {
    expect(isExecutionContextDestroyedError('Execution context was destroyed')).toBe(false)
  })

  it('does not match undefined', () => {
    expect(isExecutionContextDestroyedError(undefined)).toBe(false)
  })
})
