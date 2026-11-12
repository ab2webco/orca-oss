import { describe, expect, it } from 'vitest'
import {
  COMPACT_WORKTREE_CARD_PROPERTIES,
  DEFAULT_WORKTREE_CARD_PROPERTIES,
  PRE_AGENT_FOCUS_DEFAULT_WORKTREE_CARD_PROPERTIES,
  TASK_WORKTREE_CARD_PROPERTIES,
  isPreAgentFocusDefaultWorktreeCardProperties,
  getWorktreeCardModeProperties,
  getWorktreeCardModeUpdates,
  isDefaultedCompactWorktreeCardProperties,
  normalizeWorktreeCardProperties
} from './card-properties'

describe('worktree card properties', () => {
  it('defines Default with inline agents and without branch', () => {
    const props = getWorktreeCardModeProperties('Default')

    expect(props).toContain('inline-agents')
    expect(props).not.toContain('branch')
    expect(props).toContain('pr')
    expect(props).not.toContain('automation')
    expect(props).toEqual(DEFAULT_WORKTREE_CARD_PROPERTIES)
  })

  it('defines Compact as the status-only quiet preset', () => {
    const props = getWorktreeCardModeProperties('Compact')

    expect(props).toEqual(['status'])
    expect(props).toEqual(COMPACT_WORKTREE_CARD_PROPERTIES)
    expect(props).not.toContain('inline-agents')
    expect(props).not.toContain('issue')
    expect(props).not.toContain('linear-issue')
    expect(props).not.toContain('jira-issue')
    expect(props).not.toContain('plane-issue')
    expect(props).not.toContain('comment')
    expect(props).not.toContain('ports')
    expect(props).not.toContain('branch')
    expect(props).not.toContain('pr')
    expect(props).not.toContain('automation')
  })

  it('keeps status enabled in both presets', () => {
    expect(getWorktreeCardModeProperties('Default')).toEqual(expect.arrayContaining(['status']))
    expect(getWorktreeCardModeProperties('Compact')).toEqual(expect.arrayContaining(['status']))
  })

  it('keeps provider-specific task metadata together in Default mode', () => {
    expect(getWorktreeCardModeProperties('Default')).toEqual(
      expect.arrayContaining(TASK_WORKTREE_CARD_PROPERTIES)
    )
    expect(TASK_WORKTREE_CARD_PROPERTIES).toEqual([
      'issue',
      'linear-issue',
      'jira-issue',
      'plane-issue'
    ])
  })

  it('includes the Plane work-item property in the Default preset only', () => {
    expect(getWorktreeCardModeProperties('Default')).toContain('plane-issue')
    expect(DEFAULT_WORKTREE_CARD_PROPERTIES).toContain('plane-issue')
    expect(getWorktreeCardModeProperties('Compact')).not.toContain('plane-issue')
    expect(COMPACT_WORKTREE_CARD_PROPERTIES).not.toContain('plane-issue')
  })

  it('keeps the Plane property in canonical render order after Jira', () => {
    expect(normalizeWorktreeCardProperties(['plane-issue', 'jira-issue', 'linear-issue'])).toEqual([
      'status',
      'unread',
      'linear-issue',
      'jira-issue',
      'plane-issue'
    ])
  })

  it('normalizes fixed and legacy properties while preserving selected properties', () => {
    expect(normalizeWorktreeCardProperties(['ci', 'branch', 'pr', 'automation', 'unread'])).toEqual(
      ['status', 'unread', 'ci', 'branch', 'pr', 'automation']
    )
  })

  it('returns combined mode update payloads', () => {
    expect(getWorktreeCardModeUpdates('Compact')).toEqual({
      settings: { compactWorktreeCards: true },
      ui: {
        worktreeCardProperties: getWorktreeCardModeProperties('Compact'),
        _worktreeCardModeDefaulted: true
      }
    })
  })

  it('recognizes only exact defaulted Compact presets', () => {
    expect(isDefaultedCompactWorktreeCardProperties(['status'])).toBe(true)
    expect(isDefaultedCompactWorktreeCardProperties(['status', 'unread'])).toBe(true)
    expect(isDefaultedCompactWorktreeCardProperties(['status', 'automation'])).toBe(true)
    expect(isDefaultedCompactWorktreeCardProperties(['status', 'unread', 'automation'])).toBe(true)
    expect(isDefaultedCompactWorktreeCardProperties(['automation', 'status'])).toBe(false)
    expect(isDefaultedCompactWorktreeCardProperties(['status', 'automation', 'pr'])).toBe(false)
  })
})

// ORCA-1163: defaults show only what an agent operator acts on; the rest is opt-in.
describe('agent-focus defaults', () => {
  it('turns on status, the linked issue, the PR and agent statuses, and nothing else', () => {
    expect(DEFAULT_WORKTREE_CARD_PROPERTIES).toEqual([
      'status',
      'unread',
      'issue',
      'linear-issue',
      'jira-issue',
      'plane-issue',
      'pr',
      'inline-agents'
    ])
  })

  it('keeps the previous defaults, which notes, automation, CLI and ports were part of', () => {
    expect(PRE_AGENT_FOCUS_DEFAULT_WORKTREE_CARD_PROPERTIES).toEqual([
      'status',
      'unread',
      'issue',
      'linear-issue',
      'jira-issue',
      'plane-issue',
      'pr',
      'automation',
      'cli',
      'comment',
      'ports',
      'inline-agents'
    ])
  })

  it('recognizes an untouched profile in any order, and nothing a person changed', () => {
    expect(
      isPreAgentFocusDefaultWorktreeCardProperties(
        PRE_AGENT_FOCUS_DEFAULT_WORKTREE_CARD_PROPERTIES.toReversed()
      )
    ).toBe(true)
    expect(
      isPreAgentFocusDefaultWorktreeCardProperties(
        PRE_AGENT_FOCUS_DEFAULT_WORKTREE_CARD_PROPERTIES.filter((one) => one !== 'ports')
      )
    ).toBe(false)
    expect(
      isPreAgentFocusDefaultWorktreeCardProperties([
        ...PRE_AGENT_FOCUS_DEFAULT_WORKTREE_CARD_PROPERTIES,
        'model'
      ])
    ).toBe(false)
  })
})
