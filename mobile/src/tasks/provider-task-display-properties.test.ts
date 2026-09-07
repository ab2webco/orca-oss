import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LINEAR_TASK_DISPLAY_PROPERTIES,
  DEFAULT_PLANE_TASK_DISPLAY_PROPERTIES,
  LINEAR_TASK_DISPLAY_OPTIONS,
  PLANE_TASK_DISPLAY_OPTIONS,
  toggleTaskDisplayProperty,
  type LinearTaskDisplayProperty
} from './provider-task-display-properties'

describe('provider task display properties', () => {
  it('offers Plane a Project row and no Team or Labels row', () => {
    const values = PLANE_TASK_DISPLAY_OPTIONS.map((option) => option.value)
    expect(values).toContain('project')
    expect(values).not.toContain('team')
    expect(values).not.toContain('labels')
    expect(PLANE_TASK_DISPLAY_OPTIONS.map((option) => option.label)).toEqual([
      'Status',
      'Priority',
      'Assignee',
      'Project',
      'Updated'
    ])
  })

  it('offers Linear Team and Labels rows and no Project row', () => {
    const values = LINEAR_TASK_DISPLAY_OPTIONS.map((option) => option.value)
    expect(values).toContain('team')
    expect(values).toContain('labels')
    expect(values).not.toContain('project')
  })

  it('starts each provider with every one of its own options on', () => {
    // The control for "Plane must not start with everything off".
    expect([...DEFAULT_PLANE_TASK_DISPLAY_PROPERTIES].sort()).toEqual(
      PLANE_TASK_DISPLAY_OPTIONS.map((option) => option.value).sort()
    )
    expect([...DEFAULT_LINEAR_TASK_DISPLAY_PROPERTIES].sort()).toEqual(
      LINEAR_TASK_DISPLAY_OPTIONS.map((option) => option.value).sort()
    )
  })

  it('toggles a property in and out without mutating the input set', () => {
    const current: ReadonlySet<LinearTaskDisplayProperty> = new Set(['state', 'priority'])

    const removed = toggleTaskDisplayProperty(current, 'priority')
    expect([...removed]).toEqual(['state'])

    const added = toggleTaskDisplayProperty(current, 'labels')
    expect([...added].sort()).toEqual(['labels', 'priority', 'state'])

    expect([...current].sort()).toEqual(['priority', 'state'])
  })
})
