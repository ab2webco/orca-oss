import { describe, expect, it } from 'vitest'
import {
  gitLabTodoTargetLabel,
  taskExternalOpenLabel,
  taskKindLabel,
  taskStatusActionLabel
} from './task-item-labels'

const githubPr = { provider: 'github', source: { type: 'pr', state: 'open' } } as const
const githubIssue = { provider: 'github', source: { type: 'issue', state: 'closed' } } as const
const gitlabMr = { provider: 'gitlab', source: { type: 'mr', state: 'opened' } } as const
const gitlabIssue = { provider: 'gitlab', source: { type: 'issue', state: 'closed' } } as const
const linear = { provider: 'linear' } as const
const plane = { provider: 'plane' } as const

describe('taskKindLabel', () => {
  it.each([
    [githubPr, 'Pull request'],
    [githubIssue, 'Issue'],
    [gitlabMr, 'Merge request'],
    [gitlabIssue, 'Issue'],
    [
      { provider: 'gitlabTodo', source: { targetType: 'MergeRequest' } } as const,
      'Merge request todo'
    ],
    [{ provider: 'gitlabTodo', source: { targetType: 'Epic' } } as const, 'GitLab todo todo'],
    [plane, 'Plane work item'],
    [linear, 'Linear ticket']
  ])('labels %o as %s', (item, label) => {
    expect(taskKindLabel(item)).toBe(label)
  })
})

describe('gitLabTodoTargetLabel', () => {
  it('names the two known targets and falls back for the rest', () => {
    expect(gitLabTodoTargetLabel({ targetType: 'MergeRequest' })).toBe('Merge request')
    expect(gitLabTodoTargetLabel({ targetType: 'Issue' })).toBe('Issue')
    expect(gitLabTodoTargetLabel({ targetType: 'DesignManagement::Design' })).toBe('GitLab todo')
  })
})

describe('taskExternalOpenLabel', () => {
  it.each([
    [githubPr, 'Open in GitHub'],
    [gitlabMr, 'Open in GitLab'],
    [linear, 'Open in Linear']
  ])('labels %o as %s', (item, label) => {
    expect(taskExternalOpenLabel(item)).toBe(label)
  })
})

describe('taskStatusActionLabel', () => {
  it.each([
    [githubPr, 'Close pull request'],
    [githubIssue, 'Reopen issue'],
    [gitlabMr, 'Close merge request'],
    [gitlabIssue, 'Reopen issue'],
    [linear, '']
  ])('labels %o as %s', (item, label) => {
    expect(taskStatusActionLabel(item)).toBe(label)
  })
})
