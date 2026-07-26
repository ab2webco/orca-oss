import { describe, expect, it } from 'vitest'
import { shouldRefetchPlaneForChange } from './task-page-plane-change-scope'

const PROJECT = 'e665c0d5-22e7-495e-9ecf-3effee3ae370'
const OTHER_PROJECT = '17eb58bb-a513-4d36-9631-29c6d19c9bbc'
const WORKSPACE = 'ab2web'

describe('shouldRefetchPlaneForChange', () => {
  it('refetches while viewing every project', () => {
    // Why this case exists: 'all' is a sentinel, not an id. Comparing it directly
    // to a real projectId dropped every refresh — the reported "no se movió nada".
    expect(
      shouldRefetchPlaneForChange({
        changedProjectId: PROJECT,
        workspaceSelection: WORKSPACE,
        projectSelection: 'all'
      })
    ).toBe(true)
  })

  it('refetches while viewing every workspace', () => {
    expect(
      shouldRefetchPlaneForChange({
        changedProjectId: PROJECT,
        workspaceSelection: 'all',
        projectSelection: PROJECT
      })
    ).toBe(true)
  })

  it('refetches when the change names the project on screen', () => {
    expect(
      shouldRefetchPlaneForChange({
        changedProjectId: PROJECT,
        workspaceSelection: WORKSPACE,
        projectSelection: PROJECT
      })
    ).toBe(true)
  })

  it('ignores a change in a project that is not on screen', () => {
    // Why: a busy agent in another project must not force refetches here.
    expect(
      shouldRefetchPlaneForChange({
        changedProjectId: OTHER_PROJECT,
        workspaceSelection: WORKSPACE,
        projectSelection: PROJECT
      })
    ).toBe(false)
  })

  it('refetches on a workspace-wide change with no project to compare', () => {
    expect(
      shouldRefetchPlaneForChange({
        changedProjectId: null,
        workspaceSelection: WORKSPACE,
        projectSelection: PROJECT
      })
    ).toBe(true)
  })

  it('refetches when no workspace is selected yet', () => {
    expect(
      shouldRefetchPlaneForChange({
        changedProjectId: PROJECT,
        workspaceSelection: null,
        projectSelection: PROJECT
      })
    ).toBe(true)
  })
})
