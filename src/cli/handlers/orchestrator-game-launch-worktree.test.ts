import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_LAUNCH_HANDLERS } from './orchestrator-game-launch'
import type { RuntimeClient } from '../runtime-client'
import { RuntimeClientError } from '../runtime-client'
import { ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY } from '../../shared/protocol-version'

const LEAD_WORKTREE = 'repo1::/repo'

function worktree(path: string, branch: string, extra: Record<string, unknown> = {}) {
  return {
    id: `repo1::${path}`,
    repoId: 'repo1',
    path,
    branch: `refs/heads/${branch}`,
    displayName: path.split('/').pop(),
    isArchived: false,
    linkedPR: null,
    linkedLinearIssue: null,
    git: {
      path,
      head: 'abc',
      branch: `refs/heads/${branch}`,
      isBare: false,
      isMainWorktree: false
    },
    ...extra
  }
}

const MAIN = worktree('/repo', 'main', {
  git: {
    path: '/repo',
    head: 'abc',
    branch: 'refs/heads/main',
    isBare: false,
    isMainWorktree: true
  }
})

function stateWith(agents: unknown[] = [], unlistedMembers: unknown[] = []) {
  return {
    config: { mode: 'on' },
    agents,
    unlistedMembers,
    worktree: { id: LEAD_WORKTREE, path: '/repo', branch: 'main', displayName: 'cineco' },
    project: {
      reviews: null,
      todo: {
        provider: 'jira',
        total: 1,
        url: null,
        items: [{ id: 'CIN-12', title: 'Cartelera', url: 'u', status: 'To Do' }]
      }
    },
    lead: { autostart: false, cap: 3, agent: 'claude', launchPrompt: 'Implement {id}' }
  }
}

type Fake = {
  agents?: unknown[]
  effects?: unknown[]
  unlisted?: unknown[]
  /** Review state per branch, as hostedReview.forBranch reports it. */
  reviews?: Record<string, string>
  /** What workerStart throws after the host's own validation passes. */
  startError?: Error
  /** The live agents game.state lists once workerStart was called. */
  agentsAfterStart?: unknown[]
}

// Why the host's rule: the CLI once sent `name` with an existing worktree, which only the host refused (ORCA-894).
function refuseLikeHost(params: Record<string, unknown>): void {
  const creates = params.worktree === 'new-child' || params.worktree === 'new-top-level'
  if (!creates && ['name', 'repo', 'baseBranch', 'setup'].some((key) => params[key])) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Creation and setup options apply only to new-child or new-top-level worktrees.'
    )
  }
}

function fakeClient(worktrees: unknown[], fake: Fake = {}) {
  const calls: [string, Record<string, unknown>][] = []
  const results: Record<string, unknown> = {
    'game.state': stateWith(fake.agents, fake.unlisted),
    'worktree.list': { worktrees, totalCount: worktrees.length, truncated: false },
    'terminal.show': { terminal: { handle: 'h1' } },
    'status.get': { capabilities: [ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY] },
    'orchestration.runCurrent': { run: { id: 'run_1' } },
    'orchestration.taskCreate': { task: { id: 'task_1' } },
    'orchestration.workerStart': {
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'd1',
      state: 'ready',
      effects: fake.effects ?? []
    }
  }
  const client = {
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push([method, params])
      if (method === 'hostedReview.forBranch') {
        const state = fake.reviews?.[String(params.branch)]
        return { ok: true, result: state ? { provider: 'github', number: 925, state } : null }
      }
      if (
        method === 'game.state' &&
        fake.agentsAfterStart &&
        calls.some(([one]) => one === 'orchestration.workerStart')
      ) {
        return { ok: true, result: stateWith(fake.agentsAfterStart, fake.unlisted) }
      }
      if (method === 'orchestration.workerStart') {
        refuseLikeHost(params)
        if (fake.startError) {
          throw fake.startError
        }
      }
      return { ok: true, result: results[method] }
    }
  } as unknown as RuntimeClient
  const start = () => calls.find(([method]) => method === 'orchestration.workerStart')?.[1]
  return { client, calls, start }
}

const launch = (client: RuntimeClient, ticket = 'cin-12', extra: [string, string][] = []) =>
  ORCHESTRATOR_GAME_LAUNCH_HANDLERS['game launch']({
    flags: new Map([['ticket', ticket], ...extra]),
    client,
    cwd: '/repo',
    json: true
  })

describe('game launch: the ticket keeps its worktree', () => {
  beforeEach(() => {
    vi.stubEnv('ORCA_TERMINAL_HANDLE', 'h1')
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  })

  afterEach(() => {
    process.exitCode = undefined
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('reuses the idle worktree that holds the ticket PR branch instead of a new child', async () => {
    const old = worktree('/ws/cin-12-2', 'fab/cin-12', { linkedPR: 925 })
    const { client, calls, start } = fakeClient([MAIN, old], {
      effects: [{ kind: 'worktree', action: 'reused', id: old.id }]
    })

    await launch(client)

    expect(calls.find(([method]) => method === 'worktree.list')?.[1]).toEqual(
      expect.objectContaining({ repo: 'id:repo1' })
    )
    expect(start()).toEqual(expect.objectContaining({ worktree: 'id:repo1::/ws/cin-12-2' }))
    expect(start()).not.toHaveProperty('repo')
    expect(start()).not.toHaveProperty('name')
    // Why: the fleet reads the member's PR from the worktree this record names.
    expect(calls.findLast(([method]) => method === 'game.memberRecord')?.[1]).toEqual(
      expect.objectContaining({ member: expect.objectContaining({ worktreeId: old.id }) })
    )
  })

  it('relaunches into the idle worktree on a named account', async () => {
    const old = worktree('/ws/cin-12', 'fab/cin-12')
    const { client, calls, start } = fakeClient([MAIN, old])
    const account = { id: 'acct-2', email: 'two@example.com' }
    const call = client.call.bind(client)
    client.call = (async (method: string, params: Record<string, unknown>) =>
      method === 'accounts.snapshot'
        ? {
            ok: true,
            result: {
              claude: { accounts: [account], activeAccountId: null },
              codex: { accounts: [], activeAccountId: null }
            }
          }
        : call(method, params)) as RuntimeClient['call']

    await launch(client, 'cin-12', [['account', 'two@example.com']])

    expect(start()).toEqual(
      expect.objectContaining({ worktree: `id:${old.id}`, claudeAccountId: 'acct-2' })
    )
    expect(calls.map(([method]) => method)).not.toContain('game.memberDiscard')
  })

  it('frees the member record a refused start wrote, so the ticket never reads as paused', async () => {
    const { client, calls } = fakeClient([MAIN, worktree('/ws/cin-12', 'fab/cin-12')], {
      startError: new RuntimeClientError('agent_unconfigured', 'no launcher')
    })

    await expect(launch(client)).rejects.toThrow('no launcher')

    const recorded = calls.findIndex(([method]) => method === 'game.memberRecord')
    const freed = calls.findIndex(([method]) => method === 'game.memberDiscard')
    expect(recorded).toBeGreaterThan(-1)
    expect(freed).toBeGreaterThan(recorded)
    expect(calls[freed][1]).toEqual(expect.objectContaining({ tickets: ['CIN-12'] }))
  })

  it('keeps the record of an unlisted member whose worktree the refused start reused', async () => {
    const old = worktree('/ws/cin-12', 'fab/cin-12')
    const { client, calls, start } = fakeClient([MAIN, old], {
      unlisted: [{ ticket: 'CIN-12', name: 'Arthur', branch: 'fab/cin-12', worktreeId: old.id }],
      startError: new RuntimeClientError('invalid_argument', 'a member is live in that worktree')
    })

    await expect(launch(client)).rejects.toThrow('a member is live in that worktree')

    expect(start()).toEqual(expect.objectContaining({ worktree: `id:${old.id}` }))
    expect(calls.map(([method]) => method)).not.toContain('game.memberDiscard')
  })

  it('keeps the record of a member that went live on the ticket while the start was refused', async () => {
    const live = {
      paneKey: 'p',
      state: 'working',
      isMember: true,
      displayName: 'Arthur · CIN-12 Cartelera',
      worktree: { id: 'repo1::/ws/cin-12', branch: 'fab/cin-12', displayName: 'cin-12' }
    }
    const { client, calls } = fakeClient([MAIN], {
      agentsAfterStart: [live],
      startError: new RuntimeClientError('invalid_argument', 'CIN-12 already has a member')
    })

    await expect(launch(client)).rejects.toThrow('CIN-12 already has a member')

    expect(calls.map(([method]) => method)).not.toContain('game.memberDiscard')
  })

  it('refuses, naming the worktree and the live member, when an agent already works there', async () => {
    const old = worktree('/ws/cin-12', 'fab/cin-12')
    const member = {
      paneKey: 'p',
      state: 'working',
      isMember: true,
      displayName: 'Arthur · CIN-12 Cartelera',
      worktree: { id: old.id, branch: 'fab/cin-12', displayName: 'cin-12' }
    }
    const { client, calls } = fakeClient([MAIN, old], { agents: [member] })

    await expect(launch(client)).rejects.toThrow(
      'CIN-12 already has a live agent in /ws/cin-12 (Arthur · CIN-12 Cartelera)'
    )
    expect(calls.map(([method]) => method)).toEqual(['game.state', 'worktree.list'])
  })

  it('creates a new child worktree when no worktree belongs to the ticket', async () => {
    const { client, start } = fakeClient([MAIN, worktree('/ws/cin-9', 'fab/cin-9')])

    await launch(client)

    expect(start()).toEqual(expect.objectContaining({ worktree: 'new-child', name: 'cin-12' }))
  })

  it('looks only in the --repo repo and reuses its worktree as it is', async () => {
    const other = worktree('/be/cin-12', 'cin-12', { id: 'be::/be/cin-12', repoId: 'be' })
    const { client, calls, start } = fakeClient([other])

    await launch(client, 'cin-12', [['repo', 'cineco-be']])

    expect(calls.find(([method]) => method === 'worktree.list')?.[1]).toEqual(
      expect.objectContaining({ repo: 'cineco-be' })
    )
    expect(start()).toEqual(expect.objectContaining({ worktree: 'id:be::/be/cin-12' }))
    expect(start()).not.toHaveProperty('repo')
  })

  it('never takes the worktree of a ticket whose id only starts the same', async () => {
    const { client, start } = fakeClient([
      MAIN,
      worktree('/ws/cin-123', 'fab/cin-123'),
      worktree('/ws/xcin-12', 'fab/xcin-12')
    ])

    await launch(client)

    expect(start()).toEqual(expect.objectContaining({ worktree: 'new-child' }))
  })

  it('never takes a worktree linked to another ticket, whatever its name', async () => {
    const linked = worktree('/ws/cin-12', 'fab/cin-12', {
      linkedPlaneWorkItem: { identifier: 'CIN-99', projectId: 'p' }
    })
    const { client, start } = fakeClient([MAIN, linked])

    await launch(client)

    expect(start()).toEqual(expect.objectContaining({ worktree: 'new-child' }))
  })

  it('prefers the previous member worktree, then one linked to the ticket, then one named after it', async () => {
    const linked = worktree('/ws/feature', 'fab/feature', {
      linkedWorkItem: {
        provider: 'jira',
        type: 'issue',
        number: 12,
        title: 't',
        url: 'u',
        jiraIdentifier: 'CIN-12'
      }
    })
    const named = worktree('/ws/cin-12', 'fab/cin-12')
    const first = fakeClient([MAIN, named, linked])
    await launch(first.client)
    expect(first.start()).toEqual(expect.objectContaining({ worktree: `id:${linked.id}` }))

    // Why: a folder workspace has no branch and need not carry the ticket in its name.
    const folder = worktree('/ws/landing', '', { branch: '' })
    const second = fakeClient([MAIN, named, linked, folder], {
      unlisted: [{ ticket: 'CIN-12', name: null, branch: null, worktreeId: folder.id }]
    })
    await launch(second.client)
    expect(second.start()).toEqual(expect.objectContaining({ worktree: `id:${folder.id}` }))
  })

  it('breaks a tie by the open PR the host finds for the branch, with no link in meta', async () => {
    const fresh = worktree('/ws/cin-12-3', 'fab/cin-12-3')
    const holder = worktree('/ws/cin-12-2', 'fab/cin-12')
    const { client, calls, start } = fakeClient([MAIN, fresh, holder], {
      reviews: { 'fab/cin-12': 'open' }
    })

    await launch(client)

    expect(start()).toEqual(expect.objectContaining({ worktree: `id:${holder.id}` }))
    expect(calls.filter(([method]) => method === 'hostedReview.forBranch')).toHaveLength(2)
  })

  it('reads no review when one worktree matches, and a merged PR breaks no tie', async () => {
    const single = fakeClient([MAIN, worktree('/ws/cin-12', 'fab/cin-12')])
    await launch(single.client)
    expect(single.calls.map(([method]) => method)).not.toContain('hostedReview.forBranch')

    const merged = fakeClient(
      [MAIN, worktree('/ws/cin-12', 'fab/cin-12'), worktree('/ws/cin-12-2', 'fab/cin-12-2')],
      { reviews: { 'fab/cin-12': 'merged' } }
    )
    await expect(launch(merged.client)).rejects.toThrow('CIN-12 matches 2 worktrees')
  })

  it('refuses naming both when two worktrees match the ticket equally', async () => {
    const { client, calls } = fakeClient([
      MAIN,
      worktree('/ws/cin-12', 'fab/cin-12'),
      worktree('/ws/cin-12-2', 'fab/cin-12-2')
    ])

    await expect(launch(client)).rejects.toThrow(
      'CIN-12 matches 2 worktrees (/ws/cin-12, /ws/cin-12-2)'
    )
    expect(calls.map(([method]) => method)).toEqual([
      'game.state',
      'worktree.list',
      'hostedReview.forBranch',
      'hostedReview.forBranch'
    ])
  })

  it('skips the lead worktree, the main worktree and archived ones', async () => {
    const { client, start } = fakeClient([
      worktree('/repo', 'cin-12', { id: LEAD_WORKTREE }),
      { ...MAIN, branch: 'refs/heads/cin-12' },
      worktree('/ws/cin-12', 'fab/cin-12', { isArchived: true })
    ])

    await launch(client)

    expect(start()).toEqual(expect.objectContaining({ worktree: 'new-child' }))
  })
})
