import { describe, expect, it } from 'vitest'
import type { RuntimeWorktreeAgentRow, RuntimeWorktreePsSummary } from '../../shared/runtime-types'
import type { GameAgent } from '../../shared/orchestrator-game-state'
import {
  RemoteHostSessionsReader,
  listedRemoteWorktreesOf,
  remoteFoundSessionsOf
} from './orchestrator-game-remote-found'

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

const m1 = (worktrees: RuntimeWorktreePsSummary[], readAt = 0, answering = true) => ({
  environmentId: 'env_m1',
  host: 'm1',
  worktrees,
  readAt,
  answering
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
        stateSince: 1_000,
        hookAt: 2_000
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

  // Why (ORCA-1395): every found row claimed a known state, even from a read its host stopped refreshing.
  it('is state-known only while its host answers, and carries its hook age either way', () => {
    const rowsOf = (answering: boolean) =>
      remoteFoundSessionsOf(
        [m1([worktree('orca-915', [agentRow({ updatedAt: 4_000 })])], 10_000, answering)],
        { repoName: 'orca-oss', listed: new Set() }
      ).map((one) => [one.remote?.stateKnown, one.hookAt])

    expect(rowsOf(true)).toEqual([[true, 4_000]])
    expect(rowsOf(false)).toEqual([[false, 4_000]])
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

// Why (ORCA-1395 review): read age said "not answering" after any lead read gap, and a silent host's rows vanished.
describe("a host read's answer, not its age, says whether its found rows are known", () => {
  const foundOf = (hosts: Awaited<ReturnType<RemoteHostSessionsReader['read']>>) =>
    remoteFoundSessionsOf(hosts, { repoName: 'orca-oss', listed: new Set() }).map(
      (one) => one.remote?.stateKnown
    )
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('keeps a host that answers every read known after a long gap between lead reads', async () => {
    let now = 0
    const reader = new RemoteHostSessionsReader({
      list: () => [{ id: 'env_m1', name: 'm1' }],
      readPs: async () => ({ worktrees: [worktree('orca-915', [agentRow()])] }),
      now: () => now
    })

    await reader.read()
    now = 120_000

    expect(foundOf(await reader.read())).toEqual([true])
  })

  it("keeps a silent host's last rows, marked unknown, until it answers again", async () => {
    let now = 0
    let answers = true
    const reader = new RemoteHostSessionsReader({
      list: () => [{ id: 'env_m1', name: 'm1' }],
      readPs: async () => {
        if (!answers) {
          throw new Error('timed out')
        }
        return { worktrees: [worktree('orca-915', [agentRow()])] }
      },
      now: () => now
    })

    await reader.read()
    answers = false
    now = 40_000
    await reader.read()
    await settle()
    const silent = await reader.read()

    expect(foundOf(silent)).toEqual([false])
    expect(silent[0]?.readAt).toBe(0)
    answers = true
    now = 80_000
    await reader.read()
    await settle()
    expect(foundOf(await reader.read())).toEqual([true])
  })

  it('marks a host unknown once its reread hangs past a poll', async () => {
    let now = 0
    let hang = false
    const reader = new RemoteHostSessionsReader({
      list: () => [{ id: 'env_m1', name: 'm1' }],
      readPs: async () =>
        hang
          ? await new Promise<never>(() => {})
          : { worktrees: [worktree('orca-915', [agentRow()])] },
      now: () => now
    })

    await reader.read()
    hang = true
    now = 40_000

    expect(foundOf(await reader.read())).toEqual([true])
    now = 70_001
    expect(foundOf(await reader.read())).toEqual([false])
  })
})

describe('host worktrees a found row may not claim (ORCA-1377)', () => {
  const member = (dispatchId: string, remote: Partial<NonNullable<GameAgent['remote']>> = {}) =>
    ({
      paneKey: `remote:${dispatchId}`,
      isMember: true,
      remote: {
        host: 'm1',
        environmentId: 'env_m1',
        stateKnown: true,
        ...remote
      }
    }) as GameAgent
  const placed = (dispatchId: string, worktreeId: string, releasedAt: number | null = null) => ({
    dispatchId,
    environmentId: 'env_m1',
    worktreeId,
    releasedAt
  })

  it("holds a live member's worktree with no branch, but not a gone one's, which may run on there", () => {
    const listed = listedRemoteWorktreesOf(
      [member('d_review'), member('d_gone', { gone: true })],
      [placed('d_review', 'orca-1374'), placed('d_gone', 'orca-1297')],
      [m1([])]
    )

    expect([...listed]).toEqual(['env_m1\0orca-1374'])
  })

  // Why the second before: sqlite's clock, which stamps a release, can trail the read's (ORCA-1497).
  it('holds a released worktree for a host read taken before its release or in the second after it', () => {
    const released = [
      placed('d_a', 'orca-1351', 61_000),
      placed('d_b', 'orca-1300', 59_000),
      placed('d_c', 'orca-1299', 58_000)
    ]

    expect([...listedRemoteWorktreesOf([], released, [m1([], 60_500)])]).toEqual([
      'env_m1\0orca-1351',
      'env_m1\0orca-1300'
    ])
  })

  it('stamps a host read with when it was asked, and keeps that stamp while it serves stale', async () => {
    let now = 5_000
    const reader = new RemoteHostSessionsReader({
      list: () => [{ id: 'env_m1', name: 'm1' }],
      readPs: async () => {
        now += 400
        return { worktrees: [] }
      },
      now: () => now
    })

    const first = await reader.read()
    now = 40_000
    const stale = await reader.read()

    expect([first[0]?.readAt, stale[0]?.readAt]).toEqual([5_000, 5_000])
  })
})
