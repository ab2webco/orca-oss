import { describe, expect, it } from 'vitest'
import { GAME_TODO_ITEMS_MAX } from '../../shared/orchestrator-game-project-work'
import { readGameProjectWork, type GameProjectWorkPort } from './orchestrator-game-project-work'
import { todoSourcesOf } from './orchestrator-game-todo-sources'

const unused = async (): Promise<never> => {
  throw new Error('not expected')
}

const port = (overrides: Partial<GameProjectWorkPort>): GameProjectWorkPort => ({
  githubRepo: async () => null,
  githubPullRequests: unused,
  githubChecks: unused,
  githubIssues: unused,
  githubMergeable: async () => new Map(),
  githubMergeQueue: async () => null,
  githubBudgetLow: async () => false,
  gitlabMergeRequests: async () => null,
  gitlabIssues: unused,
  planeOpen: unused,
  jiraSearch: unused,
  linearAssigned: unused,
  ...overrides
})

const planeItem = (identifier: string, group: string, assignee?: string) => ({
  identifier,
  title: identifier,
  url: `https://app.plane.so/ab2web/browse/${identifier}/`,
  state: { id: group, name: group, group },
  ...(assignee ? { assignees: [{ id: assignee }] } : {})
})

// Why (ORCA-1168): a project's To Do held 113 unassigned tickets and the + menu read it as empty.
describe('the To Do of a known Plane project', () => {
  it('lists its unstarted tickets whoever holds them, and only my own work beyond them', async () => {
    const asked: unknown[] = []
    const work = await readGameProjectWork(
      port({
        planeOpen: async (args) => {
          asked.push(args)
          return {
            viewerId: 'me',
            items: [
              planeItem('ORCA-1', 'started', 'me'),
              planeItem('ORCA-2', 'started', 'someone'),
              planeItem('ORCA-3', 'unstarted'),
              planeItem('ORCA-4', 'unstarted', 'someone'),
              planeItem('ORCA-5', 'backlog'),
              planeItem('ORCA-6', 'backlog', 'me')
            ]
          }
        }
      }),
      { todo: { provider: 'plane', project: 'p1', workspace: 'w1' }, workItem: null }
    )

    expect(asked).toEqual([{ project: 'p1', workspace: 'w1' }])
    expect(work.todo?.items.map((one) => one.id).sort()).toEqual([
      'ORCA-1',
      'ORCA-3',
      'ORCA-4',
      'ORCA-6'
    ])
  })

  it('keeps to my own tickets when the project is not known', async () => {
    const work = await readGameProjectWork(
      port({
        planeOpen: async () => ({
          viewerId: 'me',
          items: [planeItem('ORCA-1', 'unstarted', 'me'), planeItem('ORCA-3', 'unstarted')]
        })
      }),
      { todo: null, workItem: { provider: 'plane', identifier: 'ORCA-9' } }
    )

    expect(work.todo?.items.map((one) => one.id)).toEqual(['ORCA-1'])
  })
})

const jiraIssue = (key: string, categoryKey: string) => ({
  key,
  title: key,
  url: `https://koombea.atlassian.net/browse/${key}`,
  status: { id: '1', name: key, categoryKey, categoryName: '' }
})

const githubIssue = (number: number) => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.com/o/r/issues/${number}`
})

// Why (ORCA-1168): the To Do read one tracker, so a project on Jira read only its GitHub issues.
describe('the To Do of every connected tracker', () => {
  it("merges the configured tracker with each connected one, the configured one's link first", async () => {
    const jql: string[] = []
    const work = await readGameProjectWork(
      port({
        githubRepo: async () => ({ owner: 'o', repo: 'r' }),
        githubIssues: async () => [githubIssue(7)],
        planeOpen: async () => ({ viewerId: 'me', items: [planeItem('ORCA-1', 'unstarted')] }),
        jiraSearch: async (query) => {
          jql.push(query)
          return [jiraIssue('MPP-325', 'new')]
        }
      }),
      {
        todo: { provider: 'plane', project: 'p1' },
        workItem: null,
        connected: { jira: true, linear: false }
      }
    )

    expect(jql).toEqual([
      'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC'
    ])
    expect(work.todo?.provider).toBe('plane')
    expect(work.todo?.url).toBe('https://app.plane.so/ab2web/workspace-views/assigned/')
    expect(work.todo?.total).toBe(3)
    expect(work.todo?.items.map((one) => [one.id, one.group])).toEqual([
      ['ORCA-1', 'todo'],
      ['MPP-325', 'todo'],
      ['#7', 'todo']
    ])
  })

  it('costs a failing tracker only its own list', async () => {
    const work = await readGameProjectWork(
      port({
        planeOpen: async () => ({ viewerId: 'me', items: [planeItem('ORCA-1', 'unstarted')] }),
        jiraSearch: async () => {
          throw new Error('rate limited')
        }
      }),
      {
        todo: { provider: 'plane', project: 'p1' },
        workItem: null,
        connected: { jira: true, linear: false }
      }
    )

    expect(work.todo?.items.map((one) => one.id)).toEqual(['ORCA-1'])
  })

  it('keeps room for a small tracker beside a long one', async () => {
    const work = await readGameProjectWork(
      port({
        planeOpen: async () => ({
          viewerId: 'me',
          items: Array.from({ length: 40 }, (_, at) => planeItem(`ORCA-${at + 1}`, 'unstarted'))
        }),
        jiraSearch: async () => [jiraIssue('MPP-1', 'new'), jiraIssue('MPP-2', 'new')]
      }),
      {
        todo: { provider: 'plane', project: 'p1' },
        workItem: null,
        connected: { jira: true, linear: false }
      }
    )

    const ids = work.todo?.items.map((one) => one.id) ?? []
    expect(ids).toContain('MPP-1')
    expect(ids).toContain('MPP-2')
    expect(ids).toHaveLength(GAME_TODO_ITEMS_MAX)
    expect(work.todo?.total).toBe(42)
  })

  it("reads a tracker once, as orca.yaml names it, even when the worktree's ticket names another project", async () => {
    const jql: string[] = []
    await readGameProjectWork(
      port({
        jiraSearch: async (query) => {
          jql.push(query)
          return []
        }
      }),
      {
        todo: { provider: 'jira', project: 'CIN' },
        workItem: { provider: 'jira', identifier: 'MPP-1' },
        connected: { jira: true, linear: false }
      }
    )

    expect(jql).toHaveLength(1)
    expect(jql[0]).toContain('project = CIN')
  })

  it('reads nothing when orca.yaml turns the To Do off', async () => {
    const work = await readGameProjectWork(port({}), {
      todo: 'off',
      workItem: null,
      connected: { jira: true, linear: true }
    })

    expect(work.todo).toBeNull()
  })
})

describe('todoSourcesOf', () => {
  const none = { jira: false, linear: false }
  const of = (args: Partial<Parameters<typeof todoSourcesOf>[0]>) =>
    todoSourcesOf({
      configured: null,
      planeProject: null,
      workItem: null,
      host: null,
      connected: none,
      ...args
    })

  it('reads the linked Plane project, the linked ticket tracker with its key, and the host', () => {
    expect(
      of({
        planeProject: 'p1',
        workItem: { provider: 'jira', identifier: 'CIN-12' },
        host: 'github'
      })
    ).toEqual([
      { provider: 'plane', project: 'p1' },
      { provider: 'jira', project: 'CIN' },
      { provider: 'github' }
    ])
    expect(of({ workItem: { provider: 'linear', identifier: 'ENG-3' } })).toEqual([
      { provider: 'linear', project: 'ENG' }
    ])
    expect(of({ host: 'gitlab' })).toEqual([{ provider: 'gitlab' }])
    expect(of({})).toEqual([])
  })

  it('adds a connected Jira and Linear, and lets orca.yaml name a tracker first and once', () => {
    expect(
      of({
        configured: { provider: 'jira', project: 'CIN' },
        workItem: { provider: 'jira', identifier: 'MPP-1' },
        connected: { jira: true, linear: true }
      })
    ).toEqual([{ provider: 'jira', project: 'CIN' }, { provider: 'linear' }])
  })
})
