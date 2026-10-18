import { describe, expect, it, vi } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import type { RpcClient } from '../transport/rpc-client'
import { leadMemberRoute, leadMembersOf, leadPaneKeyOf, readLeadCatalog } from './lead-members'
import type { MobileSessionTab } from './mobile-session-route-types'

const LEAD_LEAF = '11111111-1111-4111-8111-111111111111'
const MEMBER_LEAF = '22222222-2222-4222-8222-222222222222'
const LEAD_PANE = `tab-lead:${LEAD_LEAF}`

function row(paneKey: string, parentPaneKey: string | null, displayName: string | null = null) {
  return {
    paneKey,
    parentPaneKey,
    state: 'working',
    agentType: 'claude',
    prompt: '',
    taskTitle: null,
    displayName,
    lastAssistantMessage: null,
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: 0,
    updatedAt: 0
  } as RuntimeWorktreeAgentRow
}

describe('leadPaneKeyOf', () => {
  it('builds the pane key of a desktop terminal tab, and nothing for anything else', () => {
    const tab = {
      type: 'terminal',
      id: 'mobile-tab',
      title: 'lead',
      parentTabId: 'tab-lead',
      leafId: LEAD_LEAF,
      terminal: 'term_lead',
      isActive: true
    } as MobileSessionTab
    expect(leadPaneKeyOf(tab)).toBe(LEAD_PANE)
    expect(leadPaneKeyOf({ ...tab, leafId: undefined } as MobileSessionTab)).toBeNull()
    expect(leadPaneKeyOf({ ...tab, parentTabId: 'pty:wt@@1' } as MobileSessionTab)).toBeNull()
    expect(leadPaneKeyOf(null)).toBeNull()
  })
})

describe('leadMembersOf', () => {
  it('lists agents the lead launched in other worktrees, named by task then worktree', () => {
    const worktrees = [
      { worktreeId: 'wt-lead', displayName: 'lead', agents: [row(LEAD_PANE, null)] },
      {
        worktreeId: 'wt-a',
        displayName: 'orca-611-a',
        agents: [row(`tab-a:${MEMBER_LEAF}`, LEAD_PANE, 'ORCA-611 host')]
      },
      {
        worktreeId: 'wt-b',
        displayName: 'orca-611-b',
        agents: [row(`tab-b:${MEMBER_LEAF}`, LEAD_PANE)]
      },
      {
        worktreeId: 'wt-other',
        displayName: 'other',
        agents: [row(`tab-c:${MEMBER_LEAF}`, 'x:y')]
      },
      { worktreeId: 'wt-none', displayName: 'none' }
    ]
    expect(leadMembersOf(worktrees, 'wt-lead', LEAD_PANE)).toEqual([
      { worktreeId: 'wt-a', tabId: 'tab-a', label: 'ORCA-611 host', state: 'working' },
      { worktreeId: 'wt-b', tabId: 'tab-b', label: 'orca-611-b', state: 'working' }
    ])
  })

  it('keeps an in-worktree subagent out: members are only reached in their own worktree', () => {
    const worktrees = [
      {
        worktreeId: 'wt-lead',
        displayName: 'lead',
        agents: [row(LEAD_PANE, null), row(`tab-sub:${MEMBER_LEAF}`, LEAD_PANE)]
      }
    ]
    expect(leadMembersOf(worktrees, 'wt-lead', LEAD_PANE)).toEqual([])
    expect(leadMembersOf(worktrees, 'wt-lead', null)).toEqual([])
  })
})

describe('leadMemberRoute', () => {
  it('pushes the member session with its tab to select', () => {
    expect(
      leadMemberRoute('host-1', { worktreeId: 'wt-a', tabId: 'tab-a', label: 'a', state: 'idle' })
    ).toEqual({
      pathname: '/h/[hostId]/session/[worktreeId]',
      params: { hostId: 'host-1', worktreeId: 'wt-a', tab: 'tab-a' }
    })
  })
})

describe('readLeadCatalog', () => {
  it('reads the catalog the host screen cached, else asks the host once', async () => {
    const cachedRows = [{ worktreeId: 'wt-a', displayName: 'a' }]
    const sendRequest = vi.fn().mockResolvedValue({
      ok: true,
      result: { worktrees: [{ worktreeId: 'wt-b', displayName: 'b' }] }
    })
    const client = { sendRequest } as unknown as RpcClient

    expect(await readLeadCatalog(client, 'host-cached', () => cachedRows)).toBe(cachedRows)
    expect(sendRequest).not.toHaveBeenCalled()

    expect(await readLeadCatalog(client, 'host-cold', () => null)).toEqual([
      { worktreeId: 'wt-b', displayName: 'b' }
    ])
    expect(sendRequest).toHaveBeenCalledWith('worktree.ps', { limit: 10_000 })

    sendRequest.mockResolvedValueOnce({ ok: false, error: { code: 'x', message: 'x' } })
    expect(await readLeadCatalog(client, 'host-down', () => null)).toBeNull()
    sendRequest.mockRejectedValueOnce(new Error('socket closed'))
    expect(await readLeadCatalog(client, 'host-gone', () => null)).toBeNull()
  })
})
