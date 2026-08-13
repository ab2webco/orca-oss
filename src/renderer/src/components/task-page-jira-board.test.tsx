// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { JiraIssue, JiraProjectStatusOrder } from '../../../shared/types'
import { sortJiraIssues } from './jira-issue-sorter'
import { TaskPageJiraBoard } from './task-page-jira-board'

afterEach(cleanup)

function jiraIssue(key: string, statusId: string, statusName: string): JiraIssue {
  return {
    id: key,
    key,
    title: `${key} title`,
    url: `https://example.atlassian.net/browse/${key}`,
    siteId: 'site-1',
    siteName: 'Example Jira',
    project: { id: 'ALP', key: 'ALP', name: 'Alpha', siteId: 'site-1' },
    issueType: { id: '10001', name: 'Task' },
    status: {
      id: statusId,
      name: statusName,
      categoryKey: 'new',
      categoryName: statusName
    },
    labels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  }
}

describe('TaskPageJiraBoard', () => {
  it('renders read-only columns in Jira Agile board order with the reason visible', () => {
    const statusOrder: JiraProjectStatusOrder = {
      statusIdsByColumn: [['1'], ['2']]
    }
    const { container } = render(
      <TooltipProvider>
        <TaskPageJiraBoard
          formatUpdatedAt={() => 'today'}
          getStatusTone={() => 'border-border'}
          issues={[jiraIssue('ALP-1', '1', 'To Do'), jiraIssue('ALP-2', '2', 'In Progress')]}
          onOpenIssue={vi.fn()}
          onStartWorkspace={vi.fn()}
          selectedIssue={null}
          showSiteContext={false}
          statusOrder={statusOrder}
        />
      </TooltipProvider>
    )

    expect(screen.getByRole('note')).toHaveTextContent(
      'Drag is unavailable because Jira status changes require valid workflow transitions.'
    )
    const columns = [...container.querySelectorAll('[data-task-board-column]')]
    expect(columns).toHaveLength(2)
    expect(columns[0]?.querySelector('[data-task-board-column-label]')).toHaveTextContent('To Do')
    expect(columns[1]?.querySelector('[data-task-board-column-label]')).toHaveTextContent(
      'In Progress'
    )
    expect(screen.getByText('ALP-1 title').closest('[role="button"]')).toHaveAttribute(
      'draggable',
      'false'
    )
  })

  it('falls back to alphabetical status columns when Jira board metadata is unavailable', () => {
    const { container } = render(
      <TooltipProvider>
        <TaskPageJiraBoard
          formatUpdatedAt={() => 'today'}
          getStatusTone={() => 'border-border'}
          issues={[jiraIssue('ALP-1', '1', 'To Do'), jiraIssue('ALP-2', '2', 'In Progress')]}
          onOpenIssue={vi.fn()}
          onStartWorkspace={vi.fn()}
          selectedIssue={null}
          showSiteContext={false}
          statusOrder={null}
        />
      </TooltipProvider>
    )

    const labels = [...container.querySelectorAll('[data-task-board-column]')].map(
      (column) => column.querySelector('[data-task-board-column-label]')?.textContent
    )
    expect(labels).toEqual(['In Progress', 'To Do'])
  })

  it('preserves Jira board order when the list status sort is descending', () => {
    const issues = sortJiraIssues(
      [jiraIssue('ALP-1', '1', 'To Do'), jiraIssue('ALP-2', '2', 'In Progress')],
      'status',
      'desc'
    )
    const { container } = render(
      <TooltipProvider>
        <TaskPageJiraBoard
          formatUpdatedAt={() => 'today'}
          getStatusTone={() => 'border-border'}
          issues={issues}
          onOpenIssue={vi.fn()}
          onStartWorkspace={vi.fn()}
          selectedIssue={null}
          showSiteContext={false}
          statusOrder={{ statusIdsByColumn: [['1'], ['2']] }}
        />
      </TooltipProvider>
    )

    const labels = [...container.querySelectorAll('[data-task-board-column-label]')].map(
      (label) => label.textContent
    )
    expect(labels).toEqual(['To Do', 'In Progress'])
  })
})
