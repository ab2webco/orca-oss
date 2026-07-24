import { describe, expect, it } from 'vitest'
import {
  getPlaneProjectIdForFetch,
  isPlaneProjectSwitcherEnabled,
  resolveInitialPlaneProjectId,
  resolvePlaneWorkspaceIdForSlug
} from './task-page-plane-scope'

const workspaces = [
  { id: 'ws-1', workspaceSlug: 'acme' },
  { id: 'ws-2', workspaceSlug: 'beta' }
]

describe('resolvePlaneWorkspaceIdForSlug', () => {
  it('resolves the workspace id matching a slug', () => {
    expect(resolvePlaneWorkspaceIdForSlug(workspaces, 'beta')).toBe('ws-2')
  })

  it('returns null when the slug is missing or unmatched', () => {
    expect(resolvePlaneWorkspaceIdForSlug(workspaces, null)).toBeNull()
    expect(resolvePlaneWorkspaceIdForSlug(workspaces, 'gamma')).toBeNull()
  })
})

describe('resolveInitialPlaneProjectId', () => {
  it('seeds the persisted project when its workspace matches the effective workspace', () => {
    expect(
      resolveInitialPlaneProjectId(workspaces, 'ws-2', {
        workspaceSlug: 'beta',
        projectId: 'proj-2'
      })
    ).toBe('proj-2')
  })

  it('falls back to "all" when the default selection targets a different workspace', () => {
    expect(
      resolveInitialPlaneProjectId(workspaces, 'ws-1', {
        workspaceSlug: 'beta',
        projectId: 'proj-2'
      })
    ).toBe('all')
  })

  it('falls back to "all" when there is no default selection', () => {
    expect(resolveInitialPlaneProjectId(workspaces, 'ws-1', null)).toBe('all')
    expect(resolveInitialPlaneProjectId(workspaces, 'ws-1', undefined)).toBe('all')
  })

  it('falls back to "all" when the effective workspace is null (all workspaces scope)', () => {
    expect(
      resolveInitialPlaneProjectId(workspaces, null, { workspaceSlug: 'beta', projectId: 'proj-2' })
    ).toBe('all')
  })

  it('falls back to "all" when the default selection has an empty projectId', () => {
    expect(
      resolveInitialPlaneProjectId(workspaces, 'ws-2', { workspaceSlug: 'beta', projectId: '' })
    ).toBe('all')
  })
})

describe('getPlaneProjectIdForFetch', () => {
  it('returns undefined (workspace-wide) when the workspace scope is "all"', () => {
    expect(getPlaneProjectIdForFetch('all', 'proj-2')).toBeUndefined()
  })

  it('returns undefined (workspace-wide) when the workspace scope is missing', () => {
    expect(getPlaneProjectIdForFetch(null, 'proj-2')).toBeUndefined()
    expect(getPlaneProjectIdForFetch(undefined, 'proj-2')).toBeUndefined()
  })

  it('returns undefined (all projects) when the project scope is "all"', () => {
    expect(getPlaneProjectIdForFetch('ws-2', 'all')).toBeUndefined()
  })

  it('returns the project id when a single workspace and project are both selected', () => {
    expect(getPlaneProjectIdForFetch('ws-2', 'proj-2')).toBe('proj-2')
  })
})

describe('isPlaneProjectSwitcherEnabled', () => {
  it('is disabled when workspace scope is "all" or missing', () => {
    expect(isPlaneProjectSwitcherEnabled('all')).toBe(false)
    expect(isPlaneProjectSwitcherEnabled(null)).toBe(false)
    expect(isPlaneProjectSwitcherEnabled(undefined)).toBe(false)
  })

  it('is enabled once a single workspace is selected', () => {
    expect(isPlaneProjectSwitcherEnabled('ws-2')).toBe(true)
  })
})
