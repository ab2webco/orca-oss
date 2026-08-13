import { describe, expect, it } from 'vitest'
import type {
  GitHubProjectField,
  GitHubProjectRow,
  GitHubProjectTable,
  GitHubProjectView
} from './github-project-types'
import { buildGitHubProjectBoardColumns } from './github-project-board-columns'

const statusField: GitHubProjectField = {
  kind: 'single-select',
  id: 'status',
  name: 'Status',
  dataType: 'SINGLE_SELECT',
  options: [
    { id: 'todo', name: 'Todo', color: 'GRAY' },
    { id: 'doing', name: 'Doing', color: 'YELLOW' },
    { id: 'done', name: 'Done', color: 'GREEN' }
  ]
}

function row(id: string, fieldValuesByFieldId: GitHubProjectRow['fieldValuesByFieldId'] = {}) {
  return {
    id,
    itemType: 'ISSUE' as const,
    content: {
      number: 1,
      title: id,
      body: null,
      url: `https://github.com/acme/repo/issues/1`,
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
  fields: GitHubProjectField[],
  rows: GitHubProjectRow[],
  verticalGroupByFields: GitHubProjectField[] = fields
): GitHubProjectTable {
  const selectedView: GitHubProjectView = {
    id: 'view',
    number: 1,
    name: 'Board',
    layout: 'BOARD_LAYOUT',
    filter: '',
    fields,
    groupByFields: [],
    verticalGroupByFields,
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

describe('buildGitHubProjectBoardColumns', () => {
  it('keeps every single-select option in native option order, including empty columns', () => {
    const columns = buildGitHubProjectBoardColumns(
      table(
        [statusField],
        [
          row('doing-item', {
            status: {
              kind: 'single-select',
              fieldId: 'status',
              optionId: 'doing',
              name: 'Doing',
              color: 'YELLOW'
            }
          })
        ]
      )
    )

    expect(
      columns.map(({ key, label, rows }) => [key, label, rows.map((item) => item.id)])
    ).toEqual([
      ['todo', 'Todo', []],
      ['doing', 'Doing', ['doing-item']],
      ['done', 'Done', []]
    ])
  })

  it('uses the vertical group field even when it is not a single-select', () => {
    const assignees: GitHubProjectField = {
      kind: 'field',
      id: 'assignees',
      name: 'Assignees',
      dataType: 'ASSIGNEES'
    }
    const columns = buildGitHubProjectBoardColumns(
      table(
        [statusField],
        [
          row('ada', {
            assignees: {
              kind: 'users',
              fieldId: 'assignees',
              users: [{ login: 'ada', name: 'Ada', avatarUrl: null }]
            }
          }),
          row('unassigned')
        ],
        [assignees]
      )
    )

    expect(columns.map(({ key, label }) => [key, label])).toEqual([
      ['raw:ada', 'ada'],
      ['__empty__', 'No Assignees']
    ])
  })

  it('falls back to the Status field for legacy cached board views', () => {
    const columns = buildGitHubProjectBoardColumns(table([statusField], [], []))

    expect(columns.map((column) => column.label)).toEqual(['Todo', 'Doing', 'Done'])
  })
})
