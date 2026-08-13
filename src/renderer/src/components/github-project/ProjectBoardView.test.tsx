// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

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

function table(groupField: GitHubProjectField, rows: GitHubProjectRow[]): GitHubProjectTable {
  const selectedView: GitHubProjectView = {
    id: 'view',
    number: 1,
    name: 'Board',
    layout: 'BOARD_LAYOUT',
    filter: '',
    fields: [statusField],
    groupByFields: [],
    verticalGroupByFields: [groupField],
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

function renderBoard(projectTable: GitHubProjectTable, onOpenDialog = vi.fn()) {
  return {
    ...render(
      <TooltipProvider>
        <ProjectBoardView
          table={projectTable}
          onOpenDialog={onOpenDialog}
          onOpenInBrowser={vi.fn()}
          onStartWork={vi.fn()}
        />
      </TooltipProvider>
    ),
    onOpenDialog
  }
}

describe('ProjectBoardView', () => {
  it('renders every single-select option and keeps the board read-only', () => {
    const item = row('item', {
      status: {
        kind: 'single-select',
        fieldId: 'status',
        optionId: 'todo',
        name: 'Todo',
        color: 'GRAY'
      }
    })
    const { container } = renderBoard(table(statusField, [item]))

    const labels = [...container.querySelectorAll('[data-task-board-column-label]')].map(
      (label) => label.textContent
    )
    expect(labels).toEqual(['Todo', 'Done'])
    expect(screen.getByRole('note')).toHaveTextContent(
      'This board is read-only. Drag-and-drop updates are unavailable.'
    )
    expect(
      screen.getByText('item title').closest('[data-github-project-board-card]')
    ).toHaveAttribute('draggable', 'false')
  })

  it('renders columns from a non-single-select vertical group field', () => {
    const assignees: GitHubProjectField = {
      kind: 'field',
      id: 'assignees',
      name: 'Assignees',
      dataType: 'ASSIGNEES'
    }
    const { container } = renderBoard(
      table(assignees, [
        row('assigned', {
          assignees: {
            kind: 'users',
            fieldId: 'assignees',
            users: [{ login: 'ada', name: 'Ada', avatarUrl: null }]
          }
        }),
        row('unassigned')
      ])
    )

    const labels = [...container.querySelectorAll('[data-task-board-column-label]')].map(
      (label) => label.textContent
    )
    expect(labels).toEqual(['ada', 'No Assignees'])
  })

  it('opens the existing project item dialog from a card click', () => {
    const item = row('item')
    const { onOpenDialog } = renderBoard(table(statusField, [item]))

    fireEvent.click(screen.getByText('item title'))

    expect(onOpenDialog).toHaveBeenCalledWith(item)
  })
})
