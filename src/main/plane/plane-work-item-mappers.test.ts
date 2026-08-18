import { describe, expect, it } from 'vitest'
import {
  filterToPql,
  mapPlaneComment,
  mapPlaneLabel,
  mapPlaneProject,
  mapPlaneProjectMember,
  mapPlaneState,
  mapPlaneUser,
  mapPlaneWorkItem,
  UNRESOLVED_COMMENT_AUTHOR_NAME
} from './plane-work-item-mappers'
import type { PlaneProject } from '../../shared/plane-types'

describe('filterToPql', () => {
  it('pins the exact PQL string for each built-in filter', () => {
    expect(filterToPql('assigned')).toBe('assignee = currentUser() AND stateGroup IN openStates()')
    expect(filterToPql('created')).toBe('createdBy = currentUser() AND stateGroup IN openStates()')
    expect(filterToPql('done')).toBe('assignee = currentUser() AND stateGroup IN closedStates()')
    expect(filterToPql('all')).toBeUndefined()
  })
})

describe('mapPlaneProject', () => {
  it('maps identifier/name and threads workspace context through', () => {
    expect(
      mapPlaneProject({ id: 'p-1', identifier: 'ALPHA', name: 'Alpha' }, 'acme', 'ws-1')
    ).toEqual({
      id: 'p-1',
      identifier: 'ALPHA',
      name: 'Alpha',
      workspaceSlug: 'acme',
      workspaceId: 'ws-1',
      archived: false
    })
  })

  // ORCA-140: Plane's project list returns archived projects too, and dropping
  // archived_at left callers with no way to tell them apart.
  it('maps archived_at to archived: true', () => {
    expect(
      mapPlaneProject({
        id: 'p-2',
        identifier: 'ZZSMK',
        name: 'Smoke',
        archived_at: '2026-07-30T22:00:00Z'
      })
    ).toMatchObject({ id: 'p-2', archived: true })
  })

  it('maps a null or absent archived_at to archived: false', () => {
    expect(
      mapPlaneProject({ id: 'p-3', identifier: 'A', name: 'A', archived_at: null })
    ).toMatchObject({ archived: false })
    expect(mapPlaneProject({ id: 'p-4', identifier: 'B', name: 'B' })).toMatchObject({
      archived: false
    })
  })
})

describe('mapPlaneState', () => {
  it('maps native sequence and group verbatim', () => {
    expect(
      mapPlaneState({
        id: 's-1',
        name: 'In Progress',
        group: 'started',
        sequence: 2,
        color: '#00f'
      })
    ).toEqual({ id: 's-1', name: 'In Progress', group: 'started', sequence: 2, color: '#00f' })
  })
})

describe('mapPlaneUser', () => {
  it('prefers display_name, falls back to full name then email', () => {
    expect(mapPlaneUser({ id: 'u-1', display_name: 'Ada L' })).toEqual({
      id: 'u-1',
      displayName: 'Ada L',
      email: undefined,
      avatarUrl: undefined
    })
    expect(mapPlaneUser({ id: 'u-2', first_name: 'Grace', last_name: 'Hopper' })).toEqual({
      id: 'u-2',
      displayName: 'Grace Hopper',
      email: undefined,
      avatarUrl: undefined
    })
    expect(mapPlaneUser({ id: 'u-3', email: 'x@example.com' })).toEqual({
      id: 'u-3',
      displayName: 'x@example.com',
      email: 'x@example.com',
      avatarUrl: undefined
    })
    expect(mapPlaneUser({})).toBeUndefined()
  })
})

describe('mapPlaneProjectMember', () => {
  it('maps the nested `member` shape returned by the project-members endpoint', () => {
    expect(
      mapPlaneProjectMember({ member: { id: 'u-9', display_name: 'Nested Ada' }, role: 20 })
    ).toEqual({
      id: 'u-9',
      displayName: 'Nested Ada',
      email: undefined,
      avatarUrl: undefined
    })
  })

  it('falls back to the flat shape when there is no `member` wrapper', () => {
    expect(mapPlaneProjectMember({ id: 'u-3', display_name: 'Flat Grace' })).toEqual({
      id: 'u-3',
      displayName: 'Flat Grace',
      email: undefined,
      avatarUrl: undefined
    })
  })

  it('returns undefined when neither shape yields an id', () => {
    expect(mapPlaneProjectMember({ role: 20 })).toBeUndefined()
  })
})

describe('mapPlaneLabel', () => {
  it('maps id/name/color', () => {
    expect(mapPlaneLabel({ id: 'l-1', name: 'bug', color: '#f00' })).toEqual({
      id: 'l-1',
      name: 'bug',
      color: '#f00'
    })
  })
})

describe('mapPlaneComment', () => {
  it('converts comment_html to markdown and maps the actor as the user', () => {
    expect(
      mapPlaneComment({
        id: 'c-1',
        comment_html: '<p><strong>Fixed</strong> in the latest build</p>',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        actor: { id: 'u-1', display_name: 'Ada L' }
      })
    ).toEqual({
      id: 'c-1',
      body: '**Fixed** in the latest build',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      user: { id: 'u-1', displayName: 'Ada L', email: undefined, avatarUrl: undefined }
    })
  })

  it('surfaces a bare actor UUID as the author id instead of dropping the author', () => {
    expect(
      mapPlaneComment({
        id: 'c-2',
        comment_html: '<p>note</p>',
        created_at: '2026-01-01T00:00:00Z',
        actor: 'u-2'
      })
    ).toEqual({
      id: 'c-2',
      body: 'note',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: undefined,
      user: { id: 'u-2', displayName: 'u-2' }
    })
  })

  it('marks the author unresolved when actor is absent, and omits updatedAt', () => {
    expect(
      mapPlaneComment({
        id: 'c-3',
        comment_html: '<p>note</p>',
        created_at: '2026-01-01T00:00:00Z'
      })
    ).toEqual({
      id: 'c-3',
      body: 'note',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: undefined,
      user: { id: '', displayName: UNRESOLVED_COMMENT_AUTHOR_NAME }
    })
  })

  // Collapsing these two would leave "author id we could not name" and "no actor
  // at all" indistinguishable, which is the bug this file used to encode.
  it('keeps the bare-UUID and absent actors distinguishable', () => {
    const bare = mapPlaneComment({ id: 'c-4', created_at: 'x', actor: 'u-4' }).user
    const missing = mapPlaneComment({ id: 'c-5', created_at: 'x' }).user
    expect(bare).not.toEqual(missing)
    expect(bare?.id).toBe('u-4')
    expect(missing?.id).toBe('')
  })
})

describe('mapPlaneWorkItem', () => {
  const project: PlaneProject = { id: 'proj-1', identifier: 'ALPHA', name: 'Alpha Project' }

  it('maps every field, converting description_html to markdown and locking the static priority enum', () => {
    const raw = {
      id: 'wi-1',
      sequence_id: 12,
      name: 'Fix login bug',
      description_html: '<p>Steps to <strong>reproduce</strong></p>',
      priority: 'high',
      state: { id: 'state-1', name: 'In Progress', group: 'started', sequence: 2, color: '#00f' },
      labels: [{ id: 'label-1', name: 'bug', color: '#f00' }],
      assignees: [{ id: 'user-1', display_name: 'Ada Lovelace', email: 'ada@example.com' }],
      parent: 'wi-0',
      created_by: 'user-7',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z'
    }

    const item = mapPlaneWorkItem(raw, {
      baseUrl: 'https://plane.example.com',
      workspaceSlug: 'acme',
      workspaceId: 'ws-1',
      project
    })

    expect(item).toEqual({
      id: 'wi-1',
      identifier: 'ALPHA-12',
      sequenceId: 12,
      workspaceSlug: 'acme',
      workspaceId: 'ws-1',
      title: 'Fix login bug',
      description: 'Steps to **reproduce**',
      url: 'https://plane.example.com/acme/browse/ALPHA-12/',
      project,
      state: { id: 'state-1', name: 'In Progress', group: 'started', sequence: 2, color: '#00f' },
      labels: ['bug'],
      labelIds: ['label-1'],
      assignees: [
        {
          id: 'user-1',
          displayName: 'Ada Lovelace',
          email: 'ada@example.com',
          avatarUrl: undefined
        }
      ],
      priority: 'high',
      parentId: 'wi-0',
      createdBy: 'user-7',
      updatedAt: '2026-01-02T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z'
    })
  })

  it('rejects an unrecognized priority value rather than passing it through', () => {
    const item = mapPlaneWorkItem(
      { id: 'wi-2', sequence_id: 1, name: 'Untyped', priority: 'not-a-real-priority' },
      { baseUrl: 'https://api.plane.so', workspaceSlug: 'acme', project }
    )
    expect(item.priority).toBeUndefined()
  })

  it('resolves bare label UUIDs via labelsById when the API does not expand them', () => {
    const item = mapPlaneWorkItem(
      { id: 'wi-3', sequence_id: 3, name: 'Bare labels', labels: ['label-1', 'label-unknown'] },
      {
        baseUrl: 'https://api.plane.so',
        workspaceSlug: 'acme',
        project,
        labelsById: new Map([['label-1', 'Bug']])
      }
    )
    expect(item.labels).toEqual(['Bug', 'label-unknown'])
  })

  it('maps a bare assignee UUID using the id as a placeholder display name', () => {
    const item = mapPlaneWorkItem(
      { id: 'wi-4', sequence_id: 4, name: 'Bare assignee', assignees: ['user-9'] },
      { baseUrl: 'https://api.plane.so', workspaceSlug: 'acme', project }
    )
    expect(item.assignees).toEqual([{ id: 'user-9', displayName: 'user-9' }])
  })

  it('derives the app URL from api.plane.so, but keeps a self-hosted origin as-is', () => {
    const cloud = mapPlaneWorkItem(
      { id: 'wi-5', sequence_id: 5, name: 'Cloud' },
      { baseUrl: 'https://api.plane.so', workspaceSlug: 'acme', project }
    )
    expect(cloud.url).toBe('https://app.plane.so/acme/browse/ALPHA-5/')

    const selfHosted = mapPlaneWorkItem(
      { id: 'wi-6', sequence_id: 6, name: 'Self hosted' },
      { baseUrl: 'https://plane.mycompany.com', workspaceSlug: 'acme', project }
    )
    expect(selfHosted.url).toBe('https://plane.mycompany.com/acme/browse/ALPHA-6/')
  })
  it('reads the schedule and estimate the write path already accepted', () => {
    // Why this gap mattered: save-issue could set start/target dates and the API
    // stored them, but `issue` never read them back — planned work looked unplanned.
    const item = mapPlaneWorkItem(
      {
        id: 'wi-7',
        sequence_id: 7,
        name: 'Scheduled',
        start_date: '2026-07-01',
        target_date: '2026-07-15',
        estimate_point: '5'
      },
      { baseUrl: 'https://api.plane.so', workspaceSlug: 'acme', project }
    )
    expect(item.startDate).toBe('2026-07-01')
    expect(item.targetDate).toBe('2026-07-15')
    expect(item.estimatePoint).toBe('5')
  })

  it('leaves an unscheduled item without empty-string dates', () => {
    // Why undefined and not '': an empty string would render as a blank date
    // instead of reading as "not set".
    const item = mapPlaneWorkItem(
      { id: 'wi-8', sequence_id: 8, name: 'Unscheduled', start_date: null, target_date: '' },
      { baseUrl: 'https://api.plane.so', workspaceSlug: 'acme', project }
    )
    expect(item.startDate).toBeUndefined()
    expect(item.targetDate).toBeUndefined()
    expect(item.estimatePoint).toBeUndefined()
  })
})
