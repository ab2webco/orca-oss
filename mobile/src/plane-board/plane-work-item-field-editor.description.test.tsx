import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { PlaneMobileWorkItem } from '../tasks/plane-mobile-work-item-read'

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))

import { PlaneWorkItemFieldEditor } from './plane-work-item-field-editor'
import type { PlaneWorkItemDescription } from './use-plane-work-item-description'

/**
 * The write half of ORCA-464, and the one that loses data if it is wrong. The
 * editor used to seed its draft from `item.description`; on the lean list that
 * is absent, so it would open blank over a card that has a body — and leaving
 * the field would save the blank on top of it.
 */
function card(): PlaneMobileWorkItem {
  return {
    id: 'wi-1',
    identifier: 'ALPHA-1',
    sequenceId: 1,
    title: 'Wire the retry',
    url: 'https://plane.test/ALPHA-1',
    project: { id: 'proj-1', identifier: 'ALPHA', name: 'Alpha' },
    state: { id: 's-1', name: 'Todo', group: 'unstarted' },
    labels: [],
    updatedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z'
  } as PlaneMobileWorkItem
}

function mount(description: PlaneWorkItemDescription) {
  const onSave = vi.fn()
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(PlaneWorkItemFieldEditor, {
        item: card(),
        description,
        editing: false,
        clearable: true,
        onSave
      })
    )
  })
  return { renderer, onSave }
}

function inputs(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType('TextInput')
}

function textOf(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType('Text')
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''))
    .join('\n')
}

describe('the description field while its read is outstanding', () => {
  it('offers no input at all, so nothing can be saved over an unread body', () => {
    const { renderer } = mount({ state: 'loading' })

    // Title, Labels, Start date, Target date — but not Description.
    expect(inputs(renderer)).toHaveLength(4)
    expect(textOf(renderer)).toContain('Reading…')
  })

  it('shows why rather than an empty box when the read failed', () => {
    const { renderer } = mount({ state: 'failed', error: 'Plane is unreachable' })

    expect(inputs(renderer)).toHaveLength(4)
    expect(textOf(renderer)).toContain('Plane is unreachable')
  })

  it('seeds from the read, not from the row the lean list sent', () => {
    const { renderer } = mount({ state: 'ready', text: 'the real body' })
    const fields = inputs(renderer)

    expect(fields).toHaveLength(5)
    expect(fields.some((field) => field.props.value === 'the real body')).toBe(true)
  })
})
