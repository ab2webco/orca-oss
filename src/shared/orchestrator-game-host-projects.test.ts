import { describe, expect, it } from 'vitest'

import { otherProjectMembersOf, withOtherProjectMembers } from './orchestrator-game-host-projects'
import type { OrchestratorGameState } from './orchestrator-game-state'
import type { RuntimeWorktreeAgentRow, RuntimeWorktreePsSummary } from './runtime-types'

const row = (paneKey: string, extra: Partial<RuntimeWorktreeAgentRow> = {}) =>
  ({
    paneKey,
    parentPaneKey: null,
    state: 'working',
    agentType: 'claude',
    prompt: '',
    taskTitle: null,
    displayName: null,
    lastAssistantMessage: null,
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: 0,
    updatedAt: 0,
    ...extra
  }) as RuntimeWorktreeAgentRow

const worktree = (worktreeId: string, repo: string, agents: RuntimeWorktreeAgentRow[]) =>
  ({ worktreeId, repo, agents }) as unknown as RuntimeWorktreePsSummary

describe('otherProjectMembersOf (ORCA-1284)', () => {
  const ownFleet = { paneKeys: new Set(['own-1']), worktrees: new Set(['local\0wt-own-2']) }

  it('counts each other project’s dispatched members per host, never this lead’s own', () => {
    expect(
      otherProjectMembersOf(
        [
          {
            host: 'local',
            worktrees: [
              worktree('wt-own-1', 'orca-oss', [row('own-1', { dispatched: true })]),
              worktree('wt-own-2', 'orca-oss', [row('own-2', { dispatched: true })]),
              worktree('wt-c1', 'cineco', [row('c1', { dispatched: true })]),
              worktree('wt-c2', 'cineco', [row('c2', { dispatched: true, state: 'done' })]),
              worktree('wt-k1', 'koombea', [row('k1', { dispatched: true })])
            ]
          },
          {
            host: 'm1',
            worktrees: [worktree('wt-c3', 'cineco', [row('c3', { dispatched: true })])]
          }
        ],
        ownFleet
      )
    ).toEqual([
      { host: 'local', repo: 'cineco', running: 2 },
      { host: 'local', repo: 'koombea', running: 1 },
      { host: 'm1', repo: 'cineco', running: 1 }
    ])
  })

  it('leaves out sessions no lead launched, hydrated history, and an older host’s rows', () => {
    expect(
      otherProjectMembersOf(
        [
          {
            host: 'local',
            worktrees: [
              worktree('wt-a', 'cineco', [
                row('typed-by-hand'),
                row('restored', { dispatched: true, restoredUnconfirmed: true })
              ])
            ]
          },
          // Why: a host older than ORCA-1284 publishes no `dispatched`, so its rows read as unlaunched.
          { host: 'old', worktrees: [worktree('wt-b', 'cineco', [row('b1')])] }
        ],
        ownFleet
      )
    ).toEqual([])
  })
})

describe('withOtherProjectMembers (ORCA-1284)', () => {
  const lead = {
    role: 'lead',
    agents: [
      { paneKey: 'lead-pane', isLeader: true },
      { paneKey: 'remote:ctx-1', remote: { host: 'm1' }, worktree: { id: 'wt-m1-own' } }
    ]
  } as unknown as OrchestratorGameState
  const hosts = [
    {
      host: 'local',
      worktrees: [
        worktree('wt-lead', 'orca-oss', [row('sub', { dispatched: true })]),
        worktree('wt-c', 'cineco', [row('c', { dispatched: true })])
      ]
    },
    {
      host: 'm1',
      worktrees: [
        worktree('wt-m1-own', 'orca-oss', [row('m1-own', { dispatched: true })]),
        worktree('wt-m1-k', 'koombea', [row('k', { dispatched: true })])
      ]
    }
  ]

  it('leaves out the lead’s checkout and its members on paired hosts', () => {
    expect(withOtherProjectMembers(lead, hosts, 'wt-lead').otherProjectMembers).toEqual([
      { host: 'local', repo: 'cineco', running: 1 },
      { host: 'm1', repo: 'koombea', running: 1 }
    ])
  })

  it('leaves a member’s state, and a lead with no other project around, as they were', () => {
    const member = { ...lead, role: 'member' } as OrchestratorGameState
    expect(withOtherProjectMembers(member, hosts, 'wt-lead')).toBe(member)
    expect(
      withOtherProjectMembers(
        lead,
        hosts.slice(0, 1).map((one) => ({ ...one, worktrees: one.worktrees.slice(0, 1) })),
        'wt-lead'
      )
    ).toBe(lead)
  })
})
