// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  GitHubProjectField,
  GitHubProjectRow,
  GitHubProjectTable,
  GitHubProjectView
} from '../../../../shared/github-project-types'
import ProjectBoardView from './ProjectBoardView'

afterEach(cleanup)

const statusField: GitHubProjectField = {
  kind: 'single-select',
  id: 'status',
  name: 'Status',
  dataType: 'SINGLE_SELECT',
  options: [
    { id: 'todo', name: 'Todo', color: 'GRAY' },
    { id: 'done', name: 'Done', color: 'GREEN' }
  ]
}

function row(
  id: string,
  fieldValuesByFieldId: GitHubProjectRow['fieldValuesByFieldId'] = {}
): GitHubProjectRow {
  return {
    id,
    itemType: 'ISSUE',
    content: {
      number: 42,
      title: `${id} title`,
      body: null,
      url: `https://github.com/acme/repo/issues/42`,
      state: 'OPEN',
      stateReason: null,
      isDraft: false,
      repository: 'acme/repo',
      assignees: [],
      labels: [],
      parentIssue: null,
      issueType: null
    },
    fieldValuesByFieldId,
    updatedAt: '2026-01-01T00:00:00Z',
    position: 0
  }
}

function table(
  groupField: GitHubProjectField | null,
  rows: GitHubProjectRow[],
  fields: GitHubProjectField[] = [statusField]
): GitHubProjectTable {
  const selectedView: GitHubProjectView = {
    id: 'view',
    number: 1,
    name: 'Board',
    layout: 'BOARD_LAYOUT',
    filter: '',
    fields,
    groupByFields: [],
    verticalGroupByFields: groupField ? [groupField] : [],
    sortByFields: []
  }
  return {
    project: {
      id: 'project',
      owner: 'acme',
      ownerType: 'organization',
      number: 1,
      title: 'Project',
      url: 'https://github.com/orgs/acme/projects/1'
    },
    selectedView,
    rows,
    totalCount: rows.length,
    parentFieldDropped: false
  }
}

function renderBoard(
  projectTable: GitHubProjectTable,
  onEditField = vi.fn(),
  onOpenDialog = vi.fn()
) {
  return {
    ...render(
      <TooltipProvider>
        <ProjectBoardView
          table={projectTable}
          onEditField={onEditField}
          onOpenDialog={onOpenDialog}
          onOpenInBrowser={vi.fn()}
          onStartWork={vi.fn()}
        />
      </TooltipProvider>
    ),
    onEditField,
    onOpenDialog
  }
}

describe('ProjectBoardView', () => {
  it('renders native empty option columns and writes a single-select value on drop', () => {
    const item = row('item', {
      status: {
        kind: 'single-select',
        fieldId: 'status',
        optionId: 'todo',
        name: 'Todo',
        color: 'GRAY'
      }
    })
    const { container, onEditField } = renderBoard(table(statusField, [item]))

    const labels = [...container.querySelectorAll('[data-task-board-column-label]')].map(
      (label) => label.textContent
    )
    expect(labels).toEqual(['Todo', 'Done'])
    const card = screen.getByText('item title').closest('[data-github-project-board-card]')
    expect(card).toHaveAttribute('draggable', 'true')

    const doneColumn = [...container.querySelectorAll('[data-task-board-column]')].find(
      (column) => column.querySelector('[data-task-board-column-label]')?.textContent === 'Done'
    )
    fireEvent.dragStart(card!)
    fireEvent.dragOver(doneColumn!)
    fireEvent.drop(doneColumn!)

    expect(onEditField).toHaveBeenCalledWith(item, 'status', {
      kind: 'single-select',
      optionId: 'done'
    })
  })

  it('clears the single-select field when dropped into the no-value column', () => {
    const assigned = row('assigned', {
      status: {
        kind: 'single-select',
        fieldId: 'status',
        optionId: 'todo',
        name: 'Todo',
        color: 'GRAY'
      }
    })
    const unset = row('unset')
    const { container, onEditField } = renderBoard(table(statusField, [assigned, unset]))
    const noStatusColumn = [...container.querySelectorAll('[data-task-board-column]')].find(
      (column) =>
        column.querySelector('[data-task-board-column-label]')?.textContent === 'No Status'
    )

    fireEvent.dragStart(
      screen.getByText('assigned title').closest('[data-github-project-board-card]')!
    )
    fireEvent.drop(noStatusColumn!)

    expect(onEditField).toHaveBeenCalledWith(assigned, 'status', null)
  })

  it.each([
    { field: { kind: 'field', id: 'assignees', name: 'Assignees', dataType: 'ASSIGNEES' } },
    {
      field: {
        kind: 'iteration',
        id: 'iteration',
        name: 'Iteration',
        dataType: 'ITERATION',
        iterations: []
      }
    },
    { field: { kind: 'field', id: 'milestone', name: 'Milestone', dataType: 'MILESTONE' } },
    { field: { kind: 'field', id: 'repository', name: 'Repository', dataType: 'REPOSITORY' } }
  ] as { field: GitHubProjectField }[])(
    'disables dragging and does not write when grouped by $field.name',
    ({ field }) => {
      const { container, onEditField } = renderBoard(table(field, [row('item')]))
      const card = screen.getByText('item title').closest('[data-github-project-board-card]')!

      expect(screen.getByRole('note')).toHaveTextContent(
        `Drag is unavailable because this board is grouped by ${field.name}. Only single-select fields can be changed by dragging.`
      )
      expect(card).toHaveAttribute('draggable', 'false')
      fireEvent.dragStart(card)
      fireEvent.drop(container.querySelector('[data-task-board-column]')!)
      expect(onEditField).not.toHaveBeenCalled()
    }
  )

  it('disables dragging when the board has no vertical group field', () => {
    renderBoard(table(null, [row('item')], []))

    expect(screen.getByRole('note')).toHaveTextContent(
      'Drag is unavailable because this board has no vertical group field.'
    )
    expect(
      screen.getByText('item title').closest('[data-github-project-board-card]')
    ).toHaveAttribute('draggable', 'false')
  })

  it('does not expose draggable cards without a field writer', () => {
    render(
      <TooltipProvider>
        <ProjectBoardView table={table(statusField, [row('item')])} />
      </TooltipProvider>
    )

    expect(screen.getByRole('note')).toHaveTextContent(
      'Drag is unavailable because changes cannot be written in this context.'
    )
    expect(
      screen.getByText('item title').closest('[data-github-project-board-card]')
    ).toHaveAttribute('draggable', 'false')
  })

  it('opens the existing project item dialog from a card click', () => {
    const item = row('item')
    const { onOpenDialog } = renderBoard(table(statusField, [item]))

    fireEvent.click(screen.getByText('item title'))

    expect(onOpenDialog).toHaveBeenCalledWith(item)
  })

  it('locks a row while its write is pending and releases it after failure', async () => {
    let rejectWrite: (error: Error) => void = () => {}
    const write = new Promise<void>((_resolve, reject) => {
      rejectWrite = reject
    })
    const onEditField = vi.fn(() => write)
    const item = row('item', {
      status: {
        kind: 'single-select',
        fieldId: 'status',
        optionId: 'todo',
        name: 'Todo',
        color: 'GRAY'
      }
    })
    const { container } = renderBoard(table(statusField, [item]), onEditField)
    const card = screen.getByText('item title').closest('[data-github-project-board-card]')!
    const doneColumn = [...container.querySelectorAll('[data-task-board-column]')].find(
      (column) => column.querySelector('[data-task-board-column-label]')?.textContent === 'Done'
    )!

    fireEvent.dragStart(card)
    fireEvent.drop(doneColumn)
    fireEvent.dragStart(card)
    fireEvent.drop(doneColumn)

    expect(onEditField).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(card).toHaveAttribute('draggable', 'false'))
    rejectWrite(new Error('provider rejected'))
    await waitFor(() => expect(card).toHaveAttribute('draggable', 'true'))
  })

  it('does not write deleted single-select option columns', () => {
    const orphan = row('orphan', {
      status: {
        kind: 'single-select',
        fieldId: 'status',
        optionId: 'deleted',
        name: 'Deleted',
        color: 'GRAY'
      }
    })
    const source = row('source', {
      status: {
        kind: 'single-select',
        fieldId: 'status',
        optionId: 'todo',
        name: 'Todo',
        color: 'GRAY'
      }
    })
    const { container, onEditField } = renderBoard(table(statusField, [source, orphan]))
    const deletedColumn = [...container.querySelectorAll('[data-task-board-column]')].find(
      (column) => column.querySelector('[data-task-board-column-label]')?.textContent === 'Deleted'
    )!

    fireEvent.dragStart(
      screen.getByText('source title').closest('[data-github-project-board-card]')!
    )
    fireEvent.drop(deletedColumn)

    expect(onEditField).not.toHaveBeenCalled()
  })
})
