import { describe, expect, it } from 'vitest'
import { normalizeJiraViewMode } from './jira-view-mode'

describe('normalizeJiraViewMode', () => {
  it.each([
    [undefined, 'board'],
    ['board', 'board'],
    ['list', 'list'],
    ['timeline', 'board']
  ])('normalizes %s to %s', (value, expected) => {
    expect(normalizeJiraViewMode(value)).toBe(expected)
  })
})
