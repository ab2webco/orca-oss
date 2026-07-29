import { describe, expect, it } from 'vitest'
import {
  CLAUDE_STATUSLINE_ITEM_KEYS,
  DEFAULT_CLAUDE_STATUSLINE_ITEMS,
  normalizeClaudeStatusLineItemOrder,
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

describe('normalizeClaudeStatusLineItemOrder', () => {
  it('returns the declared key order for absent or malformed input', () => {
    expect(normalizeClaudeStatusLineItemOrder(undefined)).toEqual([...CLAUDE_STATUSLINE_ITEM_KEYS])
    expect(normalizeClaudeStatusLineItemOrder(null)).toEqual([...CLAUDE_STATUSLINE_ITEM_KEYS])
    expect(normalizeClaudeStatusLineItemOrder('model')).toEqual([...CLAUDE_STATUSLINE_ITEM_KEYS])
    expect(normalizeClaudeStatusLineItemOrder({ 0: 'model' })).toEqual([
      ...CLAUDE_STATUSLINE_ITEM_KEYS
    ])
  })

  it('keeps a persisted permutation as-is', () => {
    const reversed = CLAUDE_STATUSLINE_ITEM_KEYS.toReversed()
    expect(normalizeClaudeStatusLineItemOrder(reversed)).toEqual(reversed)
  })

  it('drops unknown entries and duplicates, then appends missing keys in default order', () => {
    const normalized = normalizeClaudeStatusLineItemOrder([
      'cost',
      'branch',
      'model',
      'cost',
      42,
      'account'
    ])
    expect(normalized).toEqual([
      'cost',
      'model',
      'account',
      'project',
      'context',
      'fiveHourQuota',
      'sevenDayQuota',
      'resetCountdown'
    ])
  })

  it('always returns every declared key exactly once', () => {
    const normalized = normalizeClaudeStatusLineItemOrder(['sevenDayQuota'])
    expect([...normalized].sort()).toEqual([...CLAUDE_STATUSLINE_ITEM_KEYS].sort())
  })
})
