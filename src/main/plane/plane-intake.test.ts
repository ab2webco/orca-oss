import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneClientForWorkspace } from './client'

const { acquireMock, releaseMock, getClientsMock, planeRequestMock, clearTokenMock } = vi.hoisted(
  () => ({
    acquireMock: vi.fn(async () => undefined),
    releaseMock: vi.fn(),
    getClientsMock: vi.fn(),
    planeRequestMock: vi.fn(),
    clearTokenMock: vi.fn()
  })
)

vi.mock('./client', () => ({
  acquire: acquireMock,
  release: releaseMock,
  getClients: getClientsMock,
  planeRequest: planeRequestMock,
  clearWorkspaceTokenOnAuthError: clearTokenMock
}))

const planeClient: PlaneClientForWorkspace = {
  baseUrl: 'https://plane.example.test',
  workspaceSlug: 'acme',
  headers: { 'x-api-key': 'secret', 'x-workspace-slug': 'acme' }
}

beforeEach(() => {
  getClientsMock.mockReturnValue([planeClient])
  planeRequestMock.mockReset()
  acquireMock.mockClear()
  releaseMock.mockClear()
  clearTokenMock.mockClear()
})

describe('Plane intake client', () => {
  it('creates an intake item through the intake route', async () => {
    const { createIntakeIssue } = await import('./plane-intake')
    planeRequestMock.mockResolvedValue({
      id: 'intake-1',
      issue: 'issue-1',
      issue_detail: {
        id: 'issue-1',
        name: 'Investigate latency',
        priority: 'high',
        description_html: '<p>From support</p>',
        state: 'triage-state',
        parent: null,
        labels: [],
        sequence_id: 17
      },
      status: -2,
      created_at: '2026-08-29T12:00:00Z'
    })

    const result = await createIntakeIssue({
      projectId: 'project-1',
      title: 'Investigate latency',
      description: 'From support',
      priority: 'high'
    })

    expect(result).toMatchObject({
      ok: true,
      intakeIssue: {
        id: 'intake-1',
        workItemId: 'issue-1',
        title: 'Investigate latency',
        description: '<p>From support</p>',
        priority: 'high',
        status: -2
      }
    })

    expect(planeRequestMock).toHaveBeenCalledWith(
      planeClient,
      '/api/v1/workspaces/acme/projects/project-1/intake-issues/',
      {
        method: 'POST',
        body: JSON.stringify({
          issue: {
            name: 'Investigate latency',
            description_html: '<p>From support</p>',
            priority: 'high'
          }
        })
      }
    )
  })

  it('paginates intake items until exhausted', async () => {
    const { listIntakeIssues } = await import('./plane-intake')
    planeRequestMock
      .mockResolvedValueOnce({
        results: [
          {
            id: 'intake-1',
            issue: 'issue-1',
            issue_detail: { id: 'issue-1', name: 'First' },
            status: -2,
            created_at: '2026-08-29T12:00:00Z'
          }
        ],
        next_cursor: 'next',
        next_page_results: true
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: 'intake-2',
            issue: 'issue-2',
            issue_detail: { id: 'issue-2', name: 'Second' },
            status: -2,
            created_at: '2026-08-29T13:00:00Z'
          }
        ],
        next_cursor: '',
        next_page_results: false
      })

    const result = await listIntakeIssues({ projectId: 'project-1' })

    expect(result.map((item) => item.title)).toEqual(['First', 'Second'])
    expect(planeRequestMock).toHaveBeenNthCalledWith(
      1,
      planeClient,
      '/api/v1/workspaces/acme/projects/project-1/intake-issues/?per_page=100'
    )
    expect(planeRequestMock).toHaveBeenNthCalledWith(
      2,
      planeClient,
      '/api/v1/workspaces/acme/projects/project-1/intake-issues/?per_page=100&cursor=next'
    )
  })

  it('enables intake by patching the project with both flag spellings', async () => {
    const { setIntakeEnabled } = await import('./plane-intake')
    planeRequestMock.mockResolvedValue({ id: 'project-1', intake_view: true })

    const result = await setIntakeEnabled({ projectId: 'project-1', enabled: true })

    expect(result).toEqual({ ok: true, enabled: true })
    expect(planeRequestMock).toHaveBeenCalledWith(
      planeClient,
      '/api/v1/workspaces/acme/projects/project-1/',
      expect.objectContaining({ method: 'PATCH' })
    )
    const [, , init] = planeRequestMock.mock.calls[0]
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      intake_view: true,
      inbox_view: true
    })
  })

  // Why this one carries the feature: a Plane version that does not accept the
  // flag drops it and still answers 200 with the project, so the response alone
  // is indistinguishable from success.
  it('fails when the server answers 200 without honouring the flag', async () => {
    const { setIntakeEnabled } = await import('./plane-intake')
    planeRequestMock.mockResolvedValue({ id: 'project-1', intake_view: false })

    const result = await setIntakeEnabled({ projectId: 'project-1', enabled: true })

    expect(result.ok).toBe(false)
  })

  it('fails when the project carries no intake flag at all', async () => {
    const { setIntakeEnabled } = await import('./plane-intake')
    planeRequestMock.mockResolvedValue({ id: 'project-1', name: 'Orca Lab' })

    const result = await setIntakeEnabled({ projectId: 'project-1', enabled: true })

    expect(result.ok).toBe(false)
  })

  it('reads the legacy flag when a pre-0.26 server answers with it', async () => {
    const { setIntakeEnabled } = await import('./plane-intake')
    planeRequestMock.mockResolvedValue({ id: 'project-1', inbox_view: true })

    await expect(setIntakeEnabled({ projectId: 'project-1', enabled: true })).resolves.toEqual({
      ok: true,
      enabled: true
    })
  })
})
