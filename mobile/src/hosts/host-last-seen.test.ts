import { describe, expect, it } from 'vitest'
import { hostLastSeenLabel } from './host-last-seen'

describe('hostLastSeenLabel', () => {
  it('names the local time the phone last connected to the host, as HH:MM', () => {
    const at = new Date(2026, 10, 13, 14, 2).getTime()

    expect(hostLastSeenLabel(at)).toBe('last seen 14:02')
  })

  it('names nothing for a host the phone has never connected to', () => {
    expect(hostLastSeenLabel(0)).toBeNull()
    expect(hostLastSeenLabel(undefined)).toBeNull()
  })
})
