import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  commitProjectTierMemory,
  getProjectTierMemory,
  resetProjectTierMemory,
  subscribeProjectTierMemory
} from './project-tier-memory-store'
import type { Row } from '../grouping/row-types'

const header = (key: string, tier: 1 | 2 | 3 | 4, enteredAt: number): Row => ({
  type: 'header',
  key,
  label: key,
  count: 1,
  tone: 'text-foreground',
  urgency: { tier, reason: null, enteredAt }
})

afterEach(() => resetProjectTierMemory())

describe('project tier memory store', () => {
  it('keeps what the last build drew and tells subscribers only when it changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeProjectTierMemory(listener)
    expect(commitProjectTierMemory([header('repo:a', 3, 10)])).toBe(true)
    expect(getProjectTierMemory().get('repo:a')).toEqual({ tier: 3, enteredAt: 10 })
    // A rebuild that draws the same entries must not wake the list again.
    expect(commitProjectTierMemory([header('repo:a', 3, 10)])).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(commitProjectTierMemory([header('repo:a', 1, 20)])).toBe(true)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})
