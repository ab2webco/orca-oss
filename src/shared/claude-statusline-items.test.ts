import { describe, expect, it } from 'vitest'
import {
  CLAUDE_STATUSLINE_ITEM_KEYS,
  DEFAULT_CLAUDE_STATUSLINE_ITEMS,
  normalizeClaudeStatusLineItems
} from './claude-statusline-items'

describe('normalizeClaudeStatusLineItems', () => {
  it('returns the defaults for absent or malformed input', () => {
    expect(normalizeClaudeStatusLineItems(undefined)).toEqual(DEFAULT_CLAUDE_STATUSLINE_ITEMS)
    expect(normalizeClaudeStatusLineItems(null)).toEqual(DEFAULT_CLAUDE_STATUSLINE_ITEMS)
    expect(normalizeClaudeStatusLineItems('cost')).toEqual(DEFAULT_CLAUDE_STATUSLINE_ITEMS)
    expect(normalizeClaudeStatusLineItems(42)).toEqual(DEFAULT_CLAUDE_STATUSLINE_ITEMS)
  })

  it('overlays persisted booleans onto the defaults', () => {
    const normalized = normalizeClaudeStatusLineItems({ cost: true, sevenDayQuota: false })
    expect(normalized.cost).toBe(true)
    expect(normalized.sevenDayQuota).toBe(false)
    expect(normalized.project).toBe(DEFAULT_CLAUDE_STATUSLINE_ITEMS.project)
  })

  it('ignores non-boolean and unknown keys', () => {
    const normalized = normalizeClaudeStatusLineItems({
      cost: 'yes',
      branch: true,
      model: 0
    })
    expect(normalized).toEqual(DEFAULT_CLAUDE_STATUSLINE_ITEMS)
  })

  it('never returns the shared default object itself', () => {
    const normalized = normalizeClaudeStatusLineItems(undefined)
    expect(normalized).not.toBe(DEFAULT_CLAUDE_STATUSLINE_ITEMS)
  })

  it('covers every declared key', () => {
    for (const key of CLAUDE_STATUSLINE_ITEM_KEYS) {
      expect(typeof DEFAULT_CLAUDE_STATUSLINE_ITEMS[key]).toBe('boolean')
    }
  })
})
