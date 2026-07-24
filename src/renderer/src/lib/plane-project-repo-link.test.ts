import { describe, expect, it, vi } from 'vitest'
import { savePlaneProjectRepoLink, type LinkedWorkItemSummary } from './new-workspace'

describe('savePlaneProjectRepoLink', () => {
  const planeItem: LinkedWorkItemSummary = {
    type: 'issue',
    provider: 'plane',
    number: 0,
    title: 'ORCA-1 Do the thing',
    url: 'https://plane.example/orca/ORCA-1',
    planeIdentifier: 'ORCA-1',
    planeProjectId: 'plane-project-1'
  }

  it('remembers the repo a Plane project launched into', () => {
    const setLink = vi.fn()
    savePlaneProjectRepoLink({
      linkedWorkItem: planeItem,
      repoId: 'repo-1',
      isGitRepo: true,
      setLink
    })
    expect(setLink).toHaveBeenCalledWith('plane-project-1', 'repo-1')
  })

  it('does nothing for a non-Plane linked item', () => {
    const setLink = vi.fn()
    savePlaneProjectRepoLink({
      linkedWorkItem: {
        type: 'issue',
        number: 12,
        title: 'gh issue',
        url: 'https://github.com/acme/repo/issues/12'
      },
      repoId: 'repo-1',
      isGitRepo: true,
      setLink
    })
    expect(setLink).not.toHaveBeenCalled()
  })

  it('does nothing when the Plane item carries no project id', () => {
    const setLink = vi.fn()
    const { planeProjectId: _omitted, ...withoutProjectId } = planeItem
    void _omitted
    savePlaneProjectRepoLink({
      linkedWorkItem: withoutProjectId,
      repoId: 'repo-1',
      isGitRepo: true,
      setLink
    })
    expect(setLink).not.toHaveBeenCalled()
  })

  it('does nothing for a non-git (folder) target', () => {
    const setLink = vi.fn()
    savePlaneProjectRepoLink({
      linkedWorkItem: planeItem,
      repoId: 'repo-1',
      isGitRepo: false,
      setLink
    })
    expect(setLink).not.toHaveBeenCalled()
  })
})
