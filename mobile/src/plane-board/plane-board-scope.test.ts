import { describe, expect, it } from 'vitest'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import type { PlaneBoardColumn } from './plane-board-columns'
import {
  isPlaneBoardFiltered,
  resolveLivePlaneWorkItem,
  resolvePlaneBoardScope,
  type PlaneBoardScopeInput
} from './plane-board-scope'

const PROJECTS = [
  { id: 'proj-1', identifier: 'ORCA', name: 'Orca Lab' },
  { id: 'proj-2', identifier: 'AB2', name: '' }
]

const CARD = {
  id: 'wi-1',
  title: 'Wire the retry',
  project: { id: 'proj-2', identifier: 'AB2', name: 'Ab2Web' },
  state: { id: 'state-1', name: 'Todo' },
  priority: 'none'
} as unknown as PlaneMobileWorkItem

function input(overrides: Partial<PlaneBoardScopeInput> = {}): PlaneBoardScopeInput {
  return {
    enabled: true,
    planeConnected: true,
    viewMode: 'board',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    projects: PROJECTS,
    filter: 'all',
    query: '',
    detailItem: null,
    ...overrides
  }
}

describe('resolvePlaneBoardScope', () => {
  it('reads the picked project in board mode, named from the project list', () => {
    expect(resolvePlaneBoardScope(input())).toMatchObject({
      projectId: 'proj-1',
      projectName: 'Orca Lab'
    })
  })

  it('falls back to the identifier when the project has no name', () => {
    expect(resolvePlaneBoardScope(input({ projectId: 'proj-2' })).projectName).toBe('AB2')
  })

  it('reads nothing in list mode while no card is open', () => {
    expect(resolvePlaneBoardScope(input({ viewMode: 'list' }))).toMatchObject({
      projectId: null,
      projectName: null
    })
  })

  it('follows the open card to its own project in list mode, even under "All projects"', () => {
    const scope = resolvePlaneBoardScope(
      input({ viewMode: 'list', projectId: null, detailItem: CARD })
    )
    expect(scope).toMatchObject({ projectId: 'proj-2', projectName: 'AB2' })
  })

  it('names the project from the card when the list has not heard of it', () => {
    const scope = resolvePlaneBoardScope(
      input({ viewMode: 'list', projects: [], detailItem: CARD })
    )
    expect(scope).toMatchObject({ projectId: 'proj-2', projectName: 'Ab2Web' })
  })

  it('keeps the picked project in board mode regardless of the open card', () => {
    expect(resolvePlaneBoardScope(input({ detailItem: CARD })).projectId).toBe('proj-1')
  })

  it('passes filter, query and connection through unchanged', () => {
    expect(
      resolvePlaneBoardScope(input({ filter: 'assigned', query: 'retry', planeConnected: false }))
    ).toMatchObject({ filter: 'assigned', query: 'retry', planeConnected: false, enabled: true })
  })
})

describe('isPlaneBoardFiltered', () => {
  it('treats the list default as unfiltered and anything else as narrowing', () => {
    expect(isPlaneBoardFiltered({ filter: 'all', query: '  ' })).toBe(false)
    expect(isPlaneBoardFiltered({ filter: 'assigned', query: '' })).toBe(true)
    expect(isPlaneBoardFiltered({ filter: 'all', query: 'retry' })).toBe(true)
  })
})

describe('resolveLivePlaneWorkItem', () => {
  const live = { ...CARD, priority: 'high' } as PlaneMobileWorkItem
  const columns = [
    { stateId: 'state-1', name: 'Todo', group: 'unstarted', derived: false, items: [live] }
  ] as PlaneBoardColumn[]

  it('prefers the board copy, which carries the optimistic edits', () => {
    expect(resolveLivePlaneWorkItem(columns, CARD)).toBe(live)
  })

  it('keeps the tapped row until the board has read that project', () => {
    expect(resolveLivePlaneWorkItem([], CARD)).toBe(CARD)
  })

  it('is null when nothing is open', () => {
    expect(resolveLivePlaneWorkItem(columns, null)).toBeNull()
  })
})
