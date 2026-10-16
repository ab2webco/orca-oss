import { describe, expect, it } from 'vitest'
import {
  GAME_PROJECT_ITEMS_MAX,
  gameProjectListOf,
  parseGameTodoSource,
  reviewsListUrlOf,
  reviewToneOf,
  todoListUrlOf,
  todoToneOf
} from './orchestrator-game-project-work'

describe('parseGameTodoSource', () => {
  it('takes off, a provider alone, or a provider with its project and workspace', () => {
    expect(parseGameTodoSource('off')).toEqual({ value: 'off', warnings: [] })
    expect(parseGameTodoSource({ provider: 'github' })).toEqual({
      value: { provider: 'github' },
      warnings: []
    })
    expect(
      parseGameTodoSource({ provider: 'jira', project: ' CIN ', workspace: 'koombea' })
    ).toEqual({ value: { provider: 'jira', project: 'CIN', workspace: 'koombea' }, warnings: [] })
  })

  it('refuses an unknown provider or an oversized project with a warning naming the key', () => {
    expect(parseGameTodoSource({ provider: 'trello' })).toEqual({
      value: undefined,
      warnings: [
        'orchestratorGame.todo.provider must be one of plane, jira, linear, github, gitlab'
      ]
    })
    expect(parseGameTodoSource({ provider: 'plane', project: 'x'.repeat(65) })).toEqual({
      value: undefined,
      warnings: ['orchestratorGame.todo.project must be 1 to 64 characters']
    })
    expect(parseGameTodoSource('plane').warnings).toEqual([
      'orchestratorGame.todo must be off or a mapping with provider'
    ])
  })

  it('refuses a Jira project that is not a project key, since it reaches a JQL query', () => {
    expect(parseGameTodoSource({ provider: 'jira', project: 'CIN" OR 1=1' }).warnings).toEqual([
      'orchestratorGame.todo.project must be a Jira project key like CIN'
    ])
  })
})

describe('gameProjectListOf', () => {
  it('keeps the first items with an http(s) url and counts every one it was given', () => {
    const items = Array.from({ length: 8 }, (_, at) => ({
      id: `#${at}`,
      title: `PR ${at}`,
      url: at === 1 ? 'javascript:alert(1)' : `https://github.com/o/r/pull/${at}`
    }))
    const list = gameProjectListOf('github', items, 'https://github.com/o/r/pulls', 12)
    expect(list.total).toBe(12)
    expect(list.items).toHaveLength(GAME_PROJECT_ITEMS_MAX)
    expect(list.items.map((one) => one.id)).toEqual(['#0', '#2', '#3', '#4', '#5'])
    expect(list.url).toBe('https://github.com/o/r/pulls')
  })

  it('drops a list url that is not http(s)', () => {
    expect(gameProjectListOf('jira', [], 'file:///etc/passwd').url).toBeNull()
  })
})

describe('list urls', () => {
  it('opens my open PRs on GitHub, Enterprise host included', () => {
    expect(
      reviewsListUrlOf({ provider: 'github', repo: { owner: 'ab2webco', repo: 'orca-oss' } })
    ).toBe('https://github.com/ab2webco/orca-oss/pulls?q=is%3Apr%20is%3Aopen%20author%3A%40me')
    expect(
      reviewsListUrlOf({
        provider: 'github',
        repo: { owner: 'o', repo: 'r', host: 'ghe.example.com' }
      })
    ).toBe('https://ghe.example.com/o/r/pulls?q=is%3Apr%20is%3Aopen%20author%3A%40me')
  })

  it('opens the open MRs of a GitLab project from any of its MR urls', () => {
    expect(
      reviewsListUrlOf({
        provider: 'gitlab',
        sampleUrl: 'https://gitlab.com/group/sub/project/-/merge_requests/42'
      })
    ).toBe('https://gitlab.com/group/sub/project/-/merge_requests?state=opened')
    expect(reviewsListUrlOf({ provider: 'gitlab', sampleUrl: null })).toBeNull()
  })

  it('opens the tracker view of my assigned tickets', () => {
    expect(
      todoListUrlOf({
        provider: 'plane',
        sampleUrl: 'https://app.plane.so/orca-lab/browse/ORCA-1/'
      })
    ).toBe('https://app.plane.so/orca-lab/workspace-views/assigned/')
    expect(
      todoListUrlOf({
        provider: 'jira',
        sampleUrl: 'https://koombea.atlassian.net/browse/CIN-12',
        project: 'CIN'
      })
    ).toBe(
      `https://koombea.atlassian.net/issues/?jql=${encodeURIComponent(
        'project = CIN AND assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC'
      )}`
    )
    expect(
      todoListUrlOf({
        provider: 'linear',
        sampleUrl: 'https://linear.app/acme/issue/ENG-3/fix-it'
      })
    ).toBe('https://linear.app/acme/my-issues/assigned')
    expect(todoListUrlOf({ provider: 'github', repo: { owner: 'o', repo: 'r' } })).toBe(
      'https://github.com/o/r/issues?q=is%3Aissue%20is%3Aopen%20assignee%3A%40me'
    )
    expect(
      todoListUrlOf({ provider: 'gitlab', sampleUrl: 'https://gitlab.com/g/p/-/issues/7' })
    ).toBe('https://gitlab.com/g/p/-/issues?state=opened')
  })

  it('has no list url when nothing names the tracker host', () => {
    expect(todoListUrlOf({ provider: 'plane', sampleUrl: null })).toBeNull()
    expect(todoListUrlOf({ provider: 'linear', sampleUrl: 'not a url' })).toBeNull()
  })
})

describe('tones', () => {
  it('colors a PR by its CI and a ticket by how far along it is', () => {
    expect(reviewToneOf('failure')).toBe('danger')
    expect(reviewToneOf('pending')).toBe('pending')
    expect(reviewToneOf('success')).toBe('success')
    expect(reviewToneOf('none')).toBe('neutral')
    expect(todoToneOf('in_progress')).toBe('pending')
    expect(todoToneOf('review')).toBe('success')
    expect(todoToneOf('todo')).toBe('neutral')
  })
})
