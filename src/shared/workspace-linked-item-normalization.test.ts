import { describe, expect, it } from 'vitest'
import { normalizeWorkspaceLinkedItem } from './workspace-linked-item'

const planeItem = {
  provider: 'plane',
  type: 'issue',
  number: 0,
  title: '  ORCA-151 Link Plane  ',
  url: '  https://plane.example.com/acme/browse/ORCA-151/  ',
  planeIdentifier: '  ORCA-151  ',
  repoId: '  repo-1  '
}

describe('normalizeWorkspaceLinkedItem', () => {
  it('round-trips a Plane work item and keeps its trimmed identifier', () => {
    expect(normalizeWorkspaceLinkedItem(planeItem)).toEqual({
      provider: 'plane',
      type: 'issue',
      number: 0,
      title: 'ORCA-151 Link Plane',
      url: 'https://plane.example.com/acme/browse/ORCA-151/',
      planeIdentifier: 'ORCA-151',
      repoId: 'repo-1'
    })
  })

  it('omits a blank Plane identifier instead of storing an empty string', () => {
    const normalized = normalizeWorkspaceLinkedItem({ ...planeItem, planeIdentifier: '   ' })

    expect(normalized).not.toBeNull()
    expect(Object.prototype.hasOwnProperty.call(normalized, 'planeIdentifier')).toBe(false)
  })

  it('keeps the other supported providers normalizing unchanged', () => {
    expect(
      normalizeWorkspaceLinkedItem({
        provider: 'jira',
        type: 'issue',
        number: 0,
        title: ' ORCA-123 Link Jira ',
        url: ' https://company.atlassian.net/browse/ORCA-123 ',
        jiraIdentifier: ' ORCA-123 '
      })
    ).toMatchObject({ provider: 'jira', jiraIdentifier: 'ORCA-123' })
  })

  it('still rejects providers outside the supported set', () => {
    expect(normalizeWorkspaceLinkedItem({ ...planeItem, provider: 'asana' })).toBeNull()
    expect(normalizeWorkspaceLinkedItem({ ...planeItem, provider: undefined })).toBeNull()
  })

  it('still rejects a Plane item missing a title or url', () => {
    expect(normalizeWorkspaceLinkedItem({ ...planeItem, title: '   ' })).toBeNull()
    expect(normalizeWorkspaceLinkedItem({ ...planeItem, url: '   ' })).toBeNull()
  })
})
