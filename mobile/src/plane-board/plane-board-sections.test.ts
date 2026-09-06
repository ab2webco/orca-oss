import { describe, expect, it } from 'vitest'
import type { PlaneWorkItemPriority } from '../../../src/shared/plane-types'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'
import { PLANE_TASK_GROUP_OPTIONS } from '../tasks/provider-task-view-options'
import type { PlaneBoardColumn } from './plane-board-columns'
import { planeBoardColumnStateId, planeBoardSections } from './plane-board-sections'

function card(id: string, stateId: string, priority: PlaneWorkItemPriority): PlaneMobileWorkItem {
  return {
    id,
    identifier: `ORCA-${id}`,
    title: `Card ${id}`,
    url: '',
    project: { id: 'proj-1', identifier: 'ORCA', name: 'Orca Lab' },
    state: { id: stateId, name: stateId === 'state-todo' ? 'Todo' : 'Doing', group: 'unstarted' },
    priority,
    assignees: [{ id: 'user-1', displayName: 'Fabi' }],
    updatedAt: ''
  }
}

const COLUMNS: PlaneBoardColumn[] = [
  {
    stateId: 'state-todo',
    name: 'Todo',
    group: 'unstarted',
    color: null,
    items: [card('1', 'state-todo', 'urgent')],
    derived: false
  },
  {
    stateId: 'state-doing',
    name: 'Doing',
    group: 'started',
    color: null,
    items: [card('2', 'state-doing', 'none')],
    derived: false
  }
]

const STATE_IDS = new Set(COLUMNS.map((column) => column.stateId))

describe('the state a board column creates into', () => {
  it('resolves every grouping to a real state id or to nothing at all', () => {
    // Drives off what planeBoardSections actually emitted, so the predicate cannot
    // drift from the branch it guards.
    for (const option of PLANE_TASK_GROUP_OPTIONS) {
      const sections = planeBoardSections(COLUMNS, option.value, 'priority')
      expect(sections.length).toBeGreaterThan(0)
      for (const section of sections) {
        const stateId = planeBoardColumnStateId(section, option.value)
        if (stateId !== null) {
          expect(STATE_IDS.has(stateId)).toBe(true)
        }
      }
    }
  })

  it('creates into the column under Status and No grouping', () => {
    for (const groupBy of ['none', 'status'] as const) {
      const sections = planeBoardSections(COLUMNS, groupBy, 'priority')
      expect(sections.map((section) => planeBoardColumnStateId(section, groupBy))).toEqual([
        'state-todo',
        'state-doing'
      ])
    }
  })

  it('creates into nothing under Priority or Assignee: those columns are not states', () => {
    for (const groupBy of ['priority', 'assignee'] as const) {
      const sections = planeBoardSections(COLUMNS, groupBy, 'priority')
      expect(sections.length).toBeGreaterThan(0)
      for (const section of sections) {
        expect(planeBoardColumnStateId(section, groupBy)).toBeNull()
        // The keys these carry are group keys, never something Plane would accept.
        expect(STATE_IDS.has(section.key)).toBe(false)
      }
    }
  })

  it('keeps the Status key a bare state id, not the prefixed one PLANE_GROUPING builds', () => {
    // planeBoardSections intercepts 'status' before groupProviderTasks, which would key it
    // `status:<id>`. Lose that and the composer would send Plane a destination it rejects.
    const [first] = planeBoardSections(COLUMNS, 'status', 'priority')
    expect(first.key).toBe('state-todo')
    expect(first.key.startsWith('status:')).toBe(false)
  })
})
