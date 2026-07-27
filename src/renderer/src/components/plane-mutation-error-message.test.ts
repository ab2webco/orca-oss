import { describe, expect, it } from 'vitest'
import { getPlaneMutationErrorMessage } from './plane-mutation-error-message'

describe('getPlaneMutationErrorMessage', () => {
  it('explains a confirmed offline failure', () => {
    expect(
      getPlaneMutationErrorMessage('net::ERR_INTERNET_DISCONNECTED', 'Failed to create work item.')
    ).toBe("You're offline. Check your connection and try again.")
  })

  it('distinguishes DNS failures from being offline', () => {
    expect(
      getPlaneMutationErrorMessage(
        new Error('net::ERR_NAME_NOT_RESOLVED'),
        'Failed to create work item.'
      )
    ).toBe(
      "Plane's address could not be resolved. Check your network or DNS settings and try again."
    )
  })

  it('distinguishes request timeouts from being offline', () => {
    expect(getPlaneMutationErrorMessage('net::ERR_TIMED_OUT', 'Failed to create work item.')).toBe(
      'The request to Plane timed out. Try again.'
    )
  })

  it('distinguishes Plane server failures from being offline', () => {
    expect(
      getPlaneMutationErrorMessage('HTTP 503 Service Unavailable', 'Failed to create work item.')
    ).toBe('Plane had a server error. Try again later.')
  })

  it('keeps the operation-specific fallback for unknown failures', () => {
    expect(
      getPlaneMutationErrorMessage('Unexpected mutation failure', 'Failed to create work item.')
    ).toBe('Failed to create work item.')
  })

  it('does not treat Plane identifiers as HTTP status codes', () => {
    expect(
      getPlaneMutationErrorMessage('Failed to delete ORCA-503', 'Failed to delete work item.')
    ).toBe('Failed to delete work item.')
  })

  it('does not treat a standalone work item number as an HTTP status code', () => {
    expect(
      getPlaneMutationErrorMessage('Work item 512 not found', 'Failed to update work item.')
    ).toBe('Failed to update work item.')
  })
})
