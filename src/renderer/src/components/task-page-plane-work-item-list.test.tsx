// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TooltipProvider } from '@/components/ui/tooltip'
import {
  groupPlaneWorkItemsByState,
  TaskPagePlaneWorkItemList
} from './task-page-plane-work-item-list'
import type { PlaneWorkItem } from '../../../shared/plane-types'

afterEach(cleanup)

function planeWorkItem(
  identifier: string,
  title: string,
  options: {
    stateId?: string
    stateName?: string
    stateSequence?: number
    workspaceId?: string
    assigneeNames?: string[]
  } = {}
): PlaneWorkItem {
  const workspaceId = options.workspaceId ?? 'ws-1'
  return {
    id: `${workspaceId}:${identifier}`,
    identifier,
    sequenceId: 1,
    workspaceSlug: 'acme',
    workspaceId,
    title,
    url: `https://app.plane.so/acme/browse/${identifier}/`,
    project: { id: 'proj-1', identifier: identifier.split('-')[0], name: 'Project' },
    state: {
      id: options.stateId ?? '1',
      name: options.stateName ?? 'Todo',
      group: 'unstarted',
      sequence: options.stateSequence
    },
    labels: [],
    assignees: options.assigneeNames?.map((name, index) => ({
      id: `user-${index}`,
      displayName: name
    })),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('groupPlaneWorkItemsByState', () => {
  it('groups items by state, preserving row order within a group', () => {
    const first = planeWorkItem('PROJ-1', 'First', { stateId: '1', stateName: 'To Do' })
    const second = planeWorkItem('PROJ-2', 'Second', { stateId: '2', stateName: 'In Progress' })
    const third = planeWorkItem('PROJ-3', 'Third', { stateId: '1', stateName: 'To Do' })

    const sections = groupPlaneWorkItemsByState([first, second, third])

    const toDo = sections.find((section) => section.label === 'To Do')
    expect(toDo?.items).toEqual([first, third])
  })

  it('orders groups by the state native sequence, not alphabetically', () => {
    const sections = groupPlaneWorkItemsByState([
      planeWorkItem('PROJ-1', 'Done item', { stateId: '3', stateName: 'Done', stateSequence: 3 }),
      planeWorkItem('PROJ-2', 'Todo item', { stateId: '1', stateName: 'Todo', stateSequence: 1 }),
      planeWorkItem('PROJ-3', 'Progress item', {
        stateId: '2',
        stateName: 'In Progress',
        stateSequence: 2
      })
    ])

    expect(sections.map((section) => section.label)).toEqual(['Todo', 'In Progress', 'Done'])
  })

  it('reverses group order for descending direction', () => {
    const sections = groupPlaneWorkItemsByState(
      [
        planeWorkItem('PROJ-1', 'Done item', { stateId: '3', stateName: 'Done', stateSequence: 3 }),
        planeWorkItem('PROJ-2', 'Todo item', { stateId: '1', stateName: 'Todo', stateSequence: 1 })
      ],
      'desc'
    )

    expect(sections.map((section) => section.label)).toEqual(['Done', 'Todo'])
  })

  it('breaks ties on missing sequence alphabetically', () => {
    const sections = groupPlaneWorkItemsByState([
      planeWorkItem('PROJ-1', 'Zebra state item', { stateId: '9', stateName: 'Zebra' }),
      planeWorkItem('PROJ-2', 'Alpha state item', { stateId: '8', stateName: 'Alpha' })
    ])

    expect(sections.map((section) => section.label)).toEqual(['Alpha', 'Zebra'])
  })
})

describe('TaskPagePlaneWorkItemList', () => {
  it('collapses and expands a state group through its accessible trigger', async () => {
    const user = userEvent.setup()
    render(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(TaskPagePlaneWorkItemList, {
          formatUpdatedAt: () => 'today',
          getStateTone: () => 'border-border',
          items: [
            planeWorkItem('PROJ-1', 'First item', { stateId: '1', stateName: 'Todo' }),
            planeWorkItem('PROJ-2', 'Second item', { stateId: '1', stateName: 'Todo' })
          ],
          onOpenItem: vi.fn(),
          onStartWorkspace: vi.fn(),
          selectedItem: null,
          showWorkspaceContext: false
        })
      )
    )

    const trigger = screen.getByRole('button', { name: 'Todo 2' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('First item')).toBeInTheDocument()

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('First item')).not.toBeInTheDocument()

    await user.click(trigger)
    expect(screen.getByText('First item')).toBeInTheDocument()
  })

  it('renders identifier, priority label, and assignee for a row', () => {
    render(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(TaskPagePlaneWorkItemList, {
          formatUpdatedAt: () => 'today',
          getStateTone: () => 'border-border',
          items: [
            {
              ...planeWorkItem('PROJ-7', 'Row item', {
                stateId: '1',
                stateName: 'Todo',
                assigneeNames: ['Alice']
              }),
              priority: 'high'
            }
          ],
          onOpenItem: vi.fn(),
          onStartWorkspace: vi.fn(),
          selectedItem: null,
          showWorkspaceContext: false
        })
      )
    )

    expect(screen.getAllByText('PROJ-7')[0]).toBeInTheDocument()
    expect(screen.getByText('Row item')).toBeInTheDocument()
    expect(screen.getAllByText('High')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Alice')[0]).toBeInTheDocument()
  })

  it('calls onOpenItem and onStartWorkspace from row interactions', async () => {
    const user = userEvent.setup()
    const onOpenItem = vi.fn()
    const onStartWorkspace = vi.fn()
    render(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(TaskPagePlaneWorkItemList, {
          formatUpdatedAt: () => 'today',
          getStateTone: () => 'border-border',
          items: [planeWorkItem('PROJ-7', 'Row item', { stateId: '1', stateName: 'Todo' })],
          onOpenItem,
          onStartWorkspace,
          selectedItem: null,
          showWorkspaceContext: false
        })
      )
    )

    await user.click(screen.getByText('Row item'))
    expect(onOpenItem).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Start workspace from PROJ-7' }))
    expect(onStartWorkspace).toHaveBeenCalledTimes(1)
  })
})
