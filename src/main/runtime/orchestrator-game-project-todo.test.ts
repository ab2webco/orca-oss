import { describe, expect, it } from 'vitest'
import { readGameProjectWork, type GameProjectWorkPort } from './orchestrator-game-project-work'

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
