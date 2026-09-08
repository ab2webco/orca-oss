import { describe, expect, it } from 'vitest'
import { resolveHeaderCreateTask } from './header-create-task-visibility'

describe('resolveHeaderCreateTask', () => {
  it('shows the + for Plane (ORCA-463: Plane was left out of the inline condition)', () => {
    expect(resolveHeaderCreateTask({ provider: 'plane', githubMode: 'items' })).toBe(true)
  })

  it('keeps the + for Linear', () => {
    expect(resolveHeaderCreateTask({ provider: 'linear', githubMode: 'items' })).toBe(true)
  })

  it('keeps the + for GitHub items', () => {
    expect(resolveHeaderCreateTask({ provider: 'github', githubMode: 'items' })).toBe(true)
  })

  it('hides the + for a GitHub project view', () => {
    expect(resolveHeaderCreateTask({ provider: 'github', githubMode: 'project' })).toBe(false)
  })

  it('hides the + for GitLab', () => {
    expect(resolveHeaderCreateTask({ provider: 'gitlab', githubMode: 'items' })).toBe(false)
  })
})
