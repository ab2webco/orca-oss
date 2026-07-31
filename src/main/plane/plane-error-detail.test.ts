import { describe, expect, it } from 'vitest'
import { extractPlaneErrorDetail } from './plane-error-detail'

// ORCA-140: Plane rejected a project name containing "(" with a 400 whose body
// carried the reason, and the CLI printed only "Plane request failed (400)".
describe('extractPlaneErrorDetail', () => {
  it('relays a DRF field error, naming the field', () => {
    expect(extractPlaneErrorDetail({ name: ['Special characters are not allowed.'] })).toBe(
      'name: Special characters are not allowed.'
    )
  })

  it('relays the flat shapes Plane already used', () => {
    expect(extractPlaneErrorDetail({ error: 'Project identifier is taken' })).toBe(
      'Project identifier is taken'
    )
    expect(extractPlaneErrorDetail({ detail: 'Not found.' })).toBe('Not found.')
    expect(extractPlaneErrorDetail({ message: 'Bad request' })).toBe('Bad request')
  })

  it('prefers error/detail/message over other keys and drops their key prefix', () => {
    expect(extractPlaneErrorDetail({ status: 400, error: 'Name is invalid' })).toBe(
      'Name is invalid'
    )
    expect(extractPlaneErrorDetail({ non_field_errors: ['Nope'] })).toBe('Nope')
  })

  it('joins several field errors', () => {
    expect(
      extractPlaneErrorDetail({ name: ['Too long', 'Bad characters'], identifier: ['Taken'] })
    ).toBe('name: Too long; name: Bad characters; identifier: Taken')
  })

  it('handles bare strings and bare arrays', () => {
    expect(extractPlaneErrorDetail('Plain text failure')).toBe('Plain text failure')
    expect(extractPlaneErrorDetail(['First', 'Second'])).toBe('First; Second')
  })

  it('returns undefined when nothing is quotable, so the caller keeps its fallback', () => {
    expect(extractPlaneErrorDetail({})).toBeUndefined()
    expect(extractPlaneErrorDetail(null)).toBeUndefined()
    expect(extractPlaneErrorDetail({ error: '   ' })).toBeUndefined()
    expect(extractPlaneErrorDetail({ count: 3, ok: false })).toBeUndefined()
  })

  it('bounds a pathological body instead of relaying it whole', () => {
    const detail = extractPlaneErrorDetail({ error: 'x'.repeat(5000) })
    expect(detail).toBeDefined()
    expect(detail?.length).toBeLessThanOrEqual(600)
    expect(detail?.endsWith('…')).toBe(true)
  })
})
