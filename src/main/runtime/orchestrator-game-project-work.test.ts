import { describe, expect, it } from 'vitest'
import type { PRCheckDetail } from '../../shared/github/check-types'
import type { GitHubRepositoryIdentity } from '../../shared/github/pull-request-types'
import { GAME_TODO_ITEMS_MAX } from '../../shared/orchestrator-game-project-work'
import {
  autoTodoSourceOf,
  GameProjectWorkCache,
  myOpenPullRequestsOf,
  planeWorkspaceIdOf,
  readGameProjectWork,
  type GameProjectWorkPort
} from './orchestrator-game-project-work'

const check = (conclusion: PRCheckDetail['conclusion']): PRCheckDetail => ({
  name: 'ci',
  status: conclusion === 'pending' ? 'in_progress' : 'completed',
  conclusion,
  url: null
})

const unused = async (): Promise<never> => {
  throw new Error('not expected')
}

const port = (overrides: Partial<GameProjectWorkPort>): GameProjectWorkPort => ({
  githubRepo: async () => null,
  githubPullRequests: unused,
  githubChecks: unused,
  githubIssues: unused,
  gitlabMergeRequests: async () => null,
  gitlabIssues: unused,
  planeAssigned: unused,
  jiraSearch: unused,
  linearAssigned: unused,
  ...overrides
})

describe('readGameProjectWork', () => {
  it('lists my open GitHub PRs with each one colored by its CI, and my assigned issues', async () => {
    const asked: number[] = []
    const work = await readGameProjectWork(
      port({
        githubRepo: async () => ({ owner: 'ab2webco', repo: 'orca-oss' }),
        githubPullRequests: async () => ({
          repos: [{ owner: 'ab2webco', repo: 'orca-oss' }],
          items: [
            {
              number: 469,
              title: 'Spawn race',
              url: 'https://github.com/ab2webco/orca-oss/pull/469'
            },
            { number: 470, title: 'Settings', url: 'https://github.com/ab2webco/orca-oss/pull/470' }
          ]
        }),
        githubChecks: async (pr) => {
          asked.push(pr.number)
          return pr.number === 469 ? [check('success'), check('failure')] : [check('pending')]
        },
        githubIssues: async () => [
          { number: 7, title: 'Bug', url: 'https://github.com/ab2webco/orca-oss/issues/7' }
        ]
      }),
      { todo: null, workItem: null }
    )

    expect(asked).toEqual([469, 470])
    expect(work.reviews).toEqual({
      provider: 'github',
      total: 2,
      url: 'https://github.com/ab2webco/orca-oss/pulls?q=is%3Apr%20is%3Aopen%20author%3A%40me',
      items: [
        {
          id: '#469',
          title: 'Spawn race',
          url: 'https://github.com/ab2webco/orca-oss/pull/469',
          status: 'failure',
          tone: 'danger'
        },
        {
          id: '#470',
          title: 'Settings',
          url: 'https://github.com/ab2webco/orca-oss/pull/470',
          status: 'pending',
          tone: 'pending'
        }
      ]
    })
    expect(work.todo).toEqual({
      provider: 'github',
      total: 1,
      url: 'https://github.com/ab2webco/orca-oss/issues?q=is%3Aissue%20is%3Aopen%20assignee%3A%40me',
      items: [{ id: '#7', title: 'Bug', url: 'https://github.com/ab2webco/orca-oss/issues/7' }]
    })
  })

  it("lists a fork's PRs with its upstream's, once each, opening one search over both", async () => {
    const pr = (repo: string, number: number) => ({
      number,
      title: `${repo} ${number}`,
      url: `https://github.com/${repo}/pull/${number}`
    })
    const work = await readGameProjectWork(
      port({
        githubRepo: async () => ({ owner: 'ab2webco', repo: 'orca-oss' }),
        githubPullRequests: async () => ({
          repos: [
            { owner: 'ab2webco', repo: 'orca-oss' },
            { owner: 'stablyai', repo: 'orca' }
          ],
          items: [
            pr('ab2webco/orca-oss', 471),
            pr('stablyai/orca', 90),
            pr('ab2webco/orca-oss', 471)
          ]
        }),
        githubChecks: async () => [check('success')]
      }),
      { todo: 'off', workItem: null }
    )

    expect(work.reviews?.total).toBe(2)
    expect(work.reviews?.items.map((one) => one.url)).toEqual([
      'https://github.com/ab2webco/orca-oss/pull/471',
      'https://github.com/stablyai/orca/pull/90'
    ])
    expect(work.reviews?.url).toBe(
      'https://github.com/pulls?q=is%3Apr%20is%3Aopen%20author%3A%40me%20repo%3Aab2webco%2Forca-oss%20repo%3Astablyai%2Forca'
    )
  })

  it("opens the project's own PR list when no repo holds my open PRs", async () => {
    const work = await readGameProjectWork(
      port({
        githubRepo: async () => ({ owner: 'ab2webco', repo: 'orca-oss' }),
        githubPullRequests: async () => ({ repos: [], items: [] })
      }),
      { todo: 'off', workItem: null }
    )

    expect(work.reviews?.url).toBe(
      'https://github.com/ab2webco/orca-oss/pulls?q=is%3Apr%20is%3Aopen%20author%3A%40me'
    )
  })

  it('keeps the PRs when one PR has no readable checks', async () => {
    const work = await readGameProjectWork(
      port({
        githubRepo: async () => ({ owner: 'o', repo: 'r' }),
        githubPullRequests: async () => ({
          repos: [{ owner: 'o', repo: 'r' }],
          items: [{ number: 1, title: 'One', url: 'https://github.com/o/r/pull/1' }]
        }),
        githubChecks: async () => {
          throw new Error('rate limited')
        }
      }),
      { todo: 'off', workItem: null }
    )

    expect(work.reviews?.items).toEqual([
      {
        id: '#1',
        title: 'One',
        url: 'https://github.com/o/r/pull/1',
        status: 'none',
        tone: 'neutral'
      }
    ])
    expect(work.todo).toBeNull()
  })

  it('lists my open Plane items in the configured project, leaving done and cancelled out', async () => {
    const asked: unknown[] = []
    const item = (identifier: string, group: string, name: string) => ({
      identifier,
      title: identifier,
      url: `https://app.plane.so/orca-lab/browse/${identifier}/`,
      state: { id: group, name, group }
    })
    const work = await readGameProjectWork(
      port({
        planeAssigned: async (args) => {
          asked.push(args)
          return [
            item('ORCA-1', 'started', 'In Progress'),
            item('ORCA-2', 'completed', 'Done'),
            item('ORCA-3', 'unstarted', 'Todo'),
            item('ORCA-4', 'cancelled', 'Cancelled')
          ]
        }
      }),
      { todo: { provider: 'plane', project: 'p1', workspace: 'w1' }, workItem: null }
    )

    expect(asked).toEqual([{ project: 'p1', workspace: 'w1' }])
    expect(work.todo).toEqual({
      provider: 'plane',
      total: 2,
      url: 'https://app.plane.so/orca-lab/workspace-views/assigned/',
      items: [
        {
          id: 'ORCA-1',
          title: 'ORCA-1',
          url: 'https://app.plane.so/orca-lab/browse/ORCA-1/',
          status: 'In Progress',
          tone: 'pending',
          group: 'in_progress'
        },
        {
          id: 'ORCA-3',
          title: 'ORCA-3',
          url: 'https://app.plane.so/orca-lab/browse/ORCA-3/',
          status: 'Todo',
          tone: 'neutral',
          group: 'todo'
        }
      ],
      groups: { in_progress: 1, todo: 1 }
    })
  })

  it('scopes Jira to the project key and Linear to the team key', async () => {
    const jql: string[] = []
    const jira = await readGameProjectWork(
      port({
        jiraSearch: async (query) => {
          jql.push(query)
          return [
            {
              key: 'CIN-12',
              title: 'Checkout',
              url: 'https://koombea.atlassian.net/browse/CIN-12',
              status: {
                id: '1',
                name: 'In Progress',
                categoryKey: 'indeterminate',
                categoryName: ''
              }
            }
          ]
        }
      }),
      { todo: { provider: 'jira', project: 'CIN' }, workItem: null }
    )
    expect(jql).toEqual([
      'project = CIN AND assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC'
    ])
    expect(jira.todo?.items).toEqual([
      {
        id: 'CIN-12',
        title: 'Checkout',
        url: 'https://koombea.atlassian.net/browse/CIN-12',
        status: 'In Progress',
        tone: 'pending',
        group: 'in_progress'
      }
    ])

    const linear = await readGameProjectWork(
      port({
        linearAssigned: async () => [
          {
            identifier: 'ENG-1',
            title: 'Mine',
            url: 'https://linear.app/acme/issue/ENG-1/mine',
            state: { name: 'Todo', type: 'unstarted', color: '' },
            team: { id: 't1', name: 'Eng', key: 'ENG' }
          },
          {
            identifier: 'OPS-2',
            title: 'Other team',
            url: 'https://linear.app/acme/issue/OPS-2/other',
            state: { name: 'Todo', type: 'unstarted', color: '' },
            team: { id: 't2', name: 'Ops', key: 'OPS' }
          }
        ]
      }),
      { todo: { provider: 'linear', project: 'ENG' }, workItem: null }
    )
    expect(linear.todo?.items.map((one) => one.id)).toEqual(['ENG-1'])
    expect(linear.todo?.url).toBe('https://linear.app/acme/my-issues/assigned')
  })

  it('shows the project open GitLab MRs when the repo is not on GitHub', async () => {
    const work = await readGameProjectWork(
      port({
        gitlabMergeRequests: async () => [
          {
            number: 3,
            title: 'MR',
            url: 'https://gitlab.com/g/p/-/merge_requests/3',
            state: 'opened'
          }
        ]
      }),
      { todo: 'off', workItem: null }
    )

    expect(work.reviews).toEqual({
      provider: 'gitlab',
      total: 1,
      url: 'https://gitlab.com/g/p/-/merge_requests?state=opened',
      items: [{ id: '!3', title: 'MR', url: 'https://gitlab.com/g/p/-/merge_requests/3' }]
    })
  })

  it('lists in-progress tickets first, then QA, then to do, counting each group', async () => {
    const issue = (key: string, name: string, categoryKey: string) => ({
      key,
      title: key,
      url: `https://koombea.atlassian.net/browse/${key}`,
      status: { id: key, name, categoryKey, categoryName: '' }
    })
    const work = await readGameProjectWork(
      port({
        jiraSearch: async () => [
          issue('CIN-1', 'To Do', 'new'),
          issue('CIN-2', 'QA', 'indeterminate'),
          issue('CIN-3', 'In Progress', 'indeterminate'),
          issue('CIN-4', 'To Do', 'new'),
          issue('CIN-5', 'QA', 'indeterminate'),
          issue('CIN-6', 'To Do', 'new')
        ]
      }),
      { todo: { provider: 'jira', project: 'CIN' }, workItem: null }
    )

    expect(work.todo?.items.map((one) => [one.id, one.group])).toEqual([
      ['CIN-3', 'in_progress'],
      ['CIN-2', 'review'],
      ['CIN-5', 'review'],
      ['CIN-1', 'todo'],
      ['CIN-4', 'todo'],
      ['CIN-6', 'todo']
    ])
    expect(work.todo?.total).toBe(6)
    expect(work.todo?.groups).toEqual({ in_progress: 1, review: 2, todo: 3 })
  })

  it('sends the To Do past the first in-progress tickets, so a wave can fill the free slots', async () => {
    const issue = (key: string, name: string, categoryKey: string) => ({
      key,
      title: key,
      url: `https://koombea.atlassian.net/browse/${key}`,
      status: { id: key, name, categoryKey, categoryName: '' }
    })
    const issues = Array.from({ length: 40 }, (_, at) =>
      at < 5
        ? issue(`CIN-${at}`, 'In Progress', 'indeterminate')
        : issue(`CIN-${at}`, 'To Do', 'new')
    )
    const work = await readGameProjectWork(port({ jiraSearch: async () => issues }), {
      todo: { provider: 'jira', project: 'CIN' },
      workItem: null
    })

    expect(work.todo?.items).toHaveLength(GAME_TODO_ITEMS_MAX)
    expect(work.todo?.items.filter((one) => one.group === 'todo')).toHaveLength(
      GAME_TODO_ITEMS_MAX - 5
    )
    expect(work.todo?.total).toBe(40)
  })

  it('costs a failing tracker its list, never the other one', async () => {
    const work = await readGameProjectWork(
      port({
        githubRepo: async () => ({ owner: 'o', repo: 'r' }),
        githubPullRequests: async () => ({ repos: [{ owner: 'o', repo: 'r' }], items: [] }),
        jiraSearch: async () => {
          throw new Error('offline')
        }
      }),
      { todo: { provider: 'jira' }, workItem: null }
    )

    expect(work.reviews?.total).toBe(0)
    expect(work.todo).toBeNull()
  })
})

describe('planeWorkspaceIdOf', () => {
  it("takes a workspace's slug as written in orca.yaml or Orca's own id", () => {
    const workspaces = [{ id: 'JC8r', workspaceSlug: 'ab2web' }]
    expect(planeWorkspaceIdOf(workspaces, 'ab2web')).toBe('JC8r')
    expect(planeWorkspaceIdOf(workspaces, 'JC8r')).toBe('JC8r')
    expect(planeWorkspaceIdOf(workspaces, undefined)).toBeUndefined()
    expect(planeWorkspaceIdOf(workspaces, 'unknown')).toBe('unknown')
  })
})

describe('autoTodoSourceOf', () => {
  it('prefers the Plane project linked to the repo, then the linked item tracker, then the host', () => {
    expect(autoTodoSourceOf({ planeProject: 'p1', workItem: null, host: 'github' })).toEqual({
      provider: 'plane',
      project: 'p1'
    })
    expect(
      autoTodoSourceOf({
        planeProject: null,
        workItem: { provider: 'jira', identifier: 'CIN-12' },
        host: 'github'
      })
    ).toEqual({ provider: 'jira', project: 'CIN' })
    expect(
      autoTodoSourceOf({
        planeProject: null,
        workItem: { provider: 'linear', identifier: 'ENG-3' },
        host: null
      })
    ).toEqual({ provider: 'linear', project: 'ENG' })
    expect(autoTodoSourceOf({ planeProject: null, workItem: null, host: 'gitlab' })).toEqual({
      provider: 'gitlab'
    })
    expect(autoTodoSourceOf({ planeProject: null, workItem: null, host: null })).toBeNull()
  })
})

describe('GameProjectWorkCache', () => {
  it('serves one load to concurrent and repeated reads until it expires', async () => {
    let now = 0
    let loads = 0
    const cache = new GameProjectWorkCache(90_000, () => now)
    const load = async () => {
      loads += 1
      return { reviews: null, todo: null }
    }

    await Promise.all([cache.read('repo', load), cache.read('repo', load)])
    now = 89_999
    await cache.read('repo', load)
    expect(loads).toBe(1)

    now = 90_000
    await cache.read('repo', load)
    expect(loads).toBe(2)
    await cache.read('other', load)
    expect(loads).toBe(3)
  })

  it('reads its TTL at each read, so a low GitHub budget can stretch it', async () => {
    let now = 0
    let ttl = 90_000
    let loads = 0
    const cache = new GameProjectWorkCache(
      () => ttl,
      () => now
    )
    const load = async () => {
      loads += 1
      return { reviews: null, todo: null }
    }

    await cache.read('repo', load)
    ttl = 450_000
    now = 200_000
    await cache.read('repo', load)
    expect(loads).toBe(1)
  })
})

describe('myOpenPullRequestsOf', () => {
  const fork = { owner: 'ab2webco', repo: 'orca-oss' }
  const upstream = { owner: 'stablyai', repo: 'orca' }
  const result = (prs: typeof fork, items: { number: number; type: 'pr' | 'issue' }[]) => ({
    items: items.map((one) => ({ ...one, url: `https://github.com/x/pull/${one.number}` })),
    sources: { prs, originCandidate: fork }
  })

  it("searches a fork's upstream, then the fork itself, keeping only PRs", async () => {
    const asked: string[] = []
    const found = await myOpenPullRequestsOf(async (preference) => {
      asked.push(preference)
      return preference === 'upstream'
        ? result(upstream, [{ number: 90, type: 'pr' }])
        : result(fork, [
            { number: 471, type: 'pr' },
            { number: 7, type: 'issue' }
          ])
    })

    expect(asked).toEqual(['upstream', 'origin'])
    expect(found.repos).toEqual([fork, upstream])
    expect(found.items.map((one) => one.number)).toEqual([471, 90])
  })

  it('names only the fork when my open PRs all live on it', async () => {
    const found = await myOpenPullRequestsOf(async (preference) =>
      preference === 'upstream'
        ? result(upstream, [])
        : result(fork, [
            { number: 541, type: 'pr' },
            { number: 7, type: 'issue' }
          ])
    )

    expect(found.repos).toEqual([fork])
    expect(found.items.map((one) => one.number)).toEqual([541])
  })

  it('names only the upstream when my open PRs all live there', async () => {
    const found = await myOpenPullRequestsOf(async (preference) =>
      preference === 'upstream'
        ? result(upstream, [{ number: 90, type: 'pr' }])
        : result(fork, [{ number: 7, type: 'issue' }])
    )

    expect(found.repos).toEqual([upstream])
  })

  it('names no repo when I have no open PRs, so the link falls back to the project', async () => {
    const found = await myOpenPullRequestsOf(async (preference) =>
      preference === 'upstream' ? result(upstream, []) : result(fork, [])
    )

    expect(found).toEqual({ repos: [], items: [] })
  })

  it('searches once when the repo has no upstream', async () => {
    const asked: string[] = []
    const found = await myOpenPullRequestsOf(async (preference) => {
      asked.push(preference)
      return result(fork, [{ number: 3, type: 'pr' }])
    })

    expect(asked).toEqual(['upstream'])
    expect(found).toMatchObject({ repos: [fork], items: [{ number: 3 }] })
  })
})

describe('my open PRs link, from where my PRs live', () => {
  type Repo = GitHubRepositoryIdentity
  const MINE = '/pulls?q=is%3Apr%20is%3Aopen%20author%3A%40me'
  const pageOf = (repo: Repo) => `https://${repo.host ?? 'github.com'}/${repo.owner}/${repo.repo}`

  // Why: drives the band's link through the real repo pick, from the remotes and the PRs on each.
  const linkOf = async (layout: {
    origin: Repo
    upstream?: Repo
    mine: { origin?: number[]; upstream?: number[] }
  }) => {
    const prsIn = (repo: Repo) =>
      (repo === layout.upstream ? layout.mine.upstream : layout.mine.origin) ?? []
    const search = async (preference: 'upstream' | 'origin') => {
      const searched = preference === 'origin' ? layout.origin : (layout.upstream ?? layout.origin)
      return {
        items: prsIn(searched).map((number) => ({
          number,
          type: 'pr',
          title: `#${number}`,
          url: `${pageOf(searched)}/pull/${number}`
        })),
        sources: { prs: searched, originCandidate: layout.origin }
      }
    }
    const work = await readGameProjectWork(
      port({
        githubRepo: async () => layout.origin,
        githubPullRequests: () => myOpenPullRequestsOf(search),
        githubChecks: async () => []
      }),
      { todo: 'off', workItem: null }
    )
    return work.reviews?.url
  }

  const own = { owner: 'acme', repo: 'widget' }
  const parent = { owner: 'widget-org', repo: 'widget' }

  it('opens a plain repo’s own list, with PRs or without', async () => {
    expect(await linkOf({ origin: own, mine: { origin: [4] } })).toBe(`${pageOf(own)}${MINE}`)
    expect(await linkOf({ origin: own, mine: {} })).toBe(`${pageOf(own)}${MINE}`)
  })

  it('opens the fork’s own list when my PRs live only on the fork', async () => {
    expect(await linkOf({ origin: own, upstream: parent, mine: { origin: [12, 13] } })).toBe(
      `${pageOf(own)}${MINE}`
    )
  })

  it('opens the upstream’s list when, as a contributor, my PRs live only upstream', async () => {
    expect(await linkOf({ origin: own, upstream: parent, mine: { upstream: [90] } })).toBe(
      `${pageOf(parent)}${MINE}`
    )
  })

  it('searches both when my PRs live on the fork and upstream', async () => {
    expect(
      await linkOf({ origin: own, upstream: parent, mine: { origin: [12], upstream: [90] } })
    ).toBe(
      `https://github.com/pulls?q=${encodeURIComponent('is:pr is:open author:@me repo:acme/widget repo:widget-org/widget')}`
    )
  })

  it('opens the fork’s own list, not the upstream’s, when I have no open PRs', async () => {
    expect(await linkOf({ origin: own, upstream: parent, mine: {} })).toBe(`${pageOf(own)}${MINE}`)
  })

  it('keeps a GitHub Enterprise host on the one repo that holds my PRs', async () => {
    const ghe = { ...own, host: 'git.example.com' }
    const gheParent = { ...parent, host: 'git.example.com' }
    expect(await linkOf({ origin: ghe, upstream: gheParent, mine: { origin: [5] } })).toBe(
      `https://git.example.com/acme/widget${MINE}`
    )
    expect(await linkOf({ origin: ghe, upstream: gheParent, mine: { upstream: [6] } })).toBe(
      `https://git.example.com/widget-org/widget${MINE}`
    )
  })
})
