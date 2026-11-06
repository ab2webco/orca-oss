import { describe, expect, it } from 'vitest'
import { checkStatusTone, reviewStateTone } from './review-status-tone'

describe('checkStatusTone', () => {
  it('maps running checks to working, failures to needs-you and passes to done', () => {
    expect(checkStatusTone('pending')).toBe('info')
    expect(checkStatusTone('failure')).toBe('attention')
    expect(checkStatusTone('success')).toBe('success')
    expect(checkStatusTone('neutral')).toBe('idle')
  })
})

describe('reviewStateTone', () => {
  it('treats an open review as in flight and a merged one as done', () => {
    expect(reviewStateTone('open')).toBe('info')
    expect(reviewStateTone('merged')).toBe('success')
  })

  it('keeps closed and draft reviews idle', () => {
    expect(reviewStateTone('closed')).toBe('idle')
    expect(reviewStateTone('draft')).toBe('idle')
  })
})
