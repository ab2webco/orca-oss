import { describe, expect, it } from 'vitest'
import type { Tab } from '../../../../shared/tab-types'
import { conversationTabOf } from './arcade-conversation-tab'

const tab = (
  id: string,
  contentType: Tab['contentType'],
  groupId: string,
  sortOrder: number
): Tab => ({
  id,
  entityId: id,
  groupId,
  worktreeId: 'wt',
  contentType,
  label: id,
  customLabel: null,
  color: null,
  sortOrder,
  createdAt: 0
})

describe('conversationTabOf', () => {
  it('goes back to the terminal just before the Arcade tab in its group', () => {
    const tabs = [
      tab('lead', 'terminal', 'g1', 0),
      tab('shell', 'terminal', 'g1', 1),
      tab('notes', 'editor', 'g1', 2),
      tab('arcade', 'editor', 'g1', 3),
      tab('other', 'terminal', 'g2', 0)
    ]
    expect(conversationTabOf(tabs, 'arcade')?.id).toBe('shell')
  })

  it('takes a later terminal, then any in the worktree, and none when there is no terminal', () => {
    expect(
      conversationTabOf(
        [tab('arcade', 'editor', 'g1', 0), tab('lead', 'terminal', 'g1', 1)],
        'arcade'
      )?.id
    ).toBe('lead')
    expect(
      conversationTabOf(
        [tab('arcade', 'editor', 'g1', 0), tab('far', 'terminal', 'g2', 0)],
        'arcade'
      )?.id
    ).toBe('far')
    expect(conversationTabOf([tab('arcade', 'editor', 'g1', 0)], 'arcade')).toBeNull()
  })
})
