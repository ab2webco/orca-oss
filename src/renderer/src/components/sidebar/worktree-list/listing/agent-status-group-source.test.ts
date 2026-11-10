import { describe, expect, it } from 'vitest'
import type { AppState } from '@/store/types'
import { worktree } from '../../worktree-list-groups-test-fixtures'
import { getAgentStatusGroupKey } from '../grouping/agent-status-groups'
import { selectAgentStatusGroupByWorktree } from './agent-status-group-source'

const quietState = {
  tabsByWorktree: {},
  agentStatusByPaneKey: {},
  runtimePaneTitlesByTabId: {},
  ptyIdsByTabId: {},
  migrationUnsupportedByPtyId: {},
  terminalLayoutsByTabId: {}
} as unknown as AppState

describe('getAgentStatusGroupKey', () => {
  it('maps smart-sort classes to V30 Estado buckets', () => {
    expect(getAgentStatusGroupKey({ cls: 1, attentionTimestamp: 1 })).toBe('needs-you')
    expect(getAgentStatusGroupKey({ cls: 2, attentionTimestamp: 1 })).toBe('idle')
    expect(getAgentStatusGroupKey({ cls: 3, attentionTimestamp: 1 })).toBe('working')
    expect(getAgentStatusGroupKey({ cls: 4, attentionTimestamp: 0 })).toBe('idle')
    expect(getAgentStatusGroupKey(undefined)).toBe('idle')
  })
})

describe('selectAgentStatusGroupByWorktree', () => {
  it('skips the work when the sidebar does not group by agent status', () => {
    expect(selectAgentStatusGroupByWorktree(quietState, 'repo', [worktree], 1).size).toBe(0)
  })

  it('puts a worktree with no live agent at rest', () => {
    const result = selectAgentStatusGroupByWorktree(quietState, 'agent-status', [worktree], 1)
    expect(result.get(worktree.id)).toBe('idle')
  })
})
