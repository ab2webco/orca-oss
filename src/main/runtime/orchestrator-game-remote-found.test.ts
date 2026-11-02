import { describe, expect, it } from 'vitest'
import type { RuntimeWorktreeAgentRow, RuntimeWorktreePsSummary } from '../../shared/runtime-types'
import { RemoteHostSessionsReader, remoteFoundSessionsOf } from './orchestrator-game-remote-found'

const agentRow = (overrides: Partial<RuntimeWorktreeAgentRow> = {}): RuntimeWorktreeAgentRow => ({
  paneKey: 'tab_a:11111111-1111-4111-8111-111111111111',
  parentPaneKey: null,
  state: 'working',
  agentType: 'claude',
  prompt: '',
  taskTitle: null,
  displayName: null,
  lastAssistantMessage: null,
  toolName: 'Bash',
  toolInput: null,
  interrupted: false,
  stateStartedAt: 1_000,
  updatedAt: 2_000,
  ...overrides
})

const worktree = (
  id: string,
  agents: RuntimeWorktreeAgentRow[],
  overrides: Partial<RuntimeWorktreePsSummary> = {}
): RuntimeWorktreePsSummary =>
  ({
    worktreeId: id,
    repoId: 'm1-repo',
    repo: 'orca-oss',
    path: `/Users/m1/orca/workspaces/orca-oss/${id}`,
    branch: `refs/heads/fabolivark/${id}`,
    isArchived: false,
    isMainWorktree: false,
    displayName: id,
    agents,
    ...overrides
  }) as RuntimeWorktreePsSummary

const m1 = (worktrees: RuntimeWorktreePsSummary[]) => ({
  environmentId: 'env_m1',
  host: 'm1',
  worktrees
})

// Why: agents an earlier lead run started on m1 were in no Panel or fleet; m1 showed 0/5 (ORCA-943).
describe('project sessions running on a paired host that no lead lists (ORCA-943)', () => {
  it('lists a project agent on the host as a found member with its host, ticket worktree and state', () => {
    const found = remoteFoundSessionsOf([m1([worktree('orca-915', [agentRow()])])], {
      repoName: 'orca-oss',
      listed: new Set()
    })

    expect(found).toEqual([
      {
        paneKey: 'remote-found:env_m1:tab_a:11111111-1111-4111-8111-111111111111',
        displayName: 'orca-915',
        agentType: 'claude',
        state: 'working',
        toolName: 'Bash',
        isLeader: false,
        isMember: true,
        found: true,
        remote: { host: 'm1', environmentId: 'env_m1', stateKnown: true },
        worktree: { id: 'orca-915', branch: 'fabolivark/orca-915', displayName: 'orca-915' },
        stateSince: 1_000
      }
    ])
  })

  it("leaves out another project's agents, a host's main checkout and hydrated rows", () => {
    const found = remoteFoundSessionsOf(
      [
        m1([
          worktree('cineco-1', [agentRow()], { repo: 'cineco' }),
          worktree('main', [agentRow({ paneKey: 'tab_main:x' })], { isMainWorktree: true }),
          worktree('orca-old', [agentRow({ paneKey: 'tab_old:x', restoredUnconfirmed: true })]),
          worktree('orca-gone', [agentRow({ paneKey: 'tab_arch:x' })], { isArchived: true })
        ])
      ],
      { repoName: 'orca-oss', listed: new Set() }
    )

    expect(found).toEqual([])
  })

  it('leaves out a host lead and its own members, and worktrees a lead already lists', () => {
    const hostLead = agentRow({ paneKey: 'tab_lead:x' })
    const found = remoteFoundSessionsOf(
      [
        m1([
          worktree('orca-lead', [hostLead]),
          worktree('orca-801', [agentRow({ paneKey: 'tab_m:x', parentPaneKey: 'tab_lead:x' })]),
          worktree('orca-805', [agentRow({ paneKey: 'tab_listed:x' })]),
          worktree('orca-329', [agentRow({ paneKey: 'tab_329:x', state: 'done', toolName: null })])
        ])
      ],
      { repoName: 'orca-oss', listed: new Set(['env_m1\0orca-805']) }
    )

    expect(found.map((one) => [one.displayName, one.state])).toEqual([['orca-329', 'done']])
  })
})

describe('reading paired hosts for sessions (ORCA-943)', () => {
  it('reads each host once per 30 s, and lists none for a host that does not answer', async () => {
    let now = 0
    const reads: string[] = []
    const reader = new RemoteHostSessionsReader({
      list: () => [
        { id: 'env_m1', name: 'm1' },
        { id: 'env_imac', name: 'imac' }
      ],
      readPs: async (environmentId) => {
        reads.push(environmentId)
        if (environmentId === 'env_imac') {
          throw new Error('offline')
        }
        return { worktrees: [worktree('orca-915', [agentRow()])] }
      },
      now: () => now
    })

    const first = await reader.read()
    now = 10_000
    await reader.read()

    expect(first.map((one) => [one.host, one.worktrees.length])).toEqual([
      ['m1', 1],
      ['imac', 0]
    ])
    expect(reads).toEqual(['env_m1', 'env_imac'])
  })
})
