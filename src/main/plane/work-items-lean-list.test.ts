import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneClientForWorkspace } from './client'
import type { PlaneViewer } from '../../shared/plane-types'

/**
 * ORCA-464's control, and it asserts BYTES, not shape. A test that only checks
 * `description` is absent passes just as happily once some other field has
 * grown to fill the space — and the whole point of the ticket is a 5 s call,
 * not a field.
 *
 * The numbers it is defending: 108 items, 354 KB, 3.3 KB each, of which
 * `description` was 1892 B — 58% of the payload that no row renders.
 */
const {
  acquireMock,
  releaseMock,
  getClientsMock,
  planeRequestMock,
  clearWorkspaceTokenOnAuthErrorMock,
  getCachedViewerMock,
  setCachedViewerMock
} = vi.hoisted(() => ({
  acquireMock: vi.fn(async () => undefined),
  releaseMock: vi.fn(),
  getClientsMock: vi.fn(),
  planeRequestMock: vi.fn(),
  clearWorkspaceTokenOnAuthErrorMock: vi.fn(),
  getCachedViewerMock: vi.fn((): PlaneViewer | null => null),
  setCachedViewerMock: vi.fn()
}))

vi.mock('./client', () => ({
  acquire: acquireMock,
  release: releaseMock,
  getClients: getClientsMock,
  planeRequest: planeRequestMock,
  PlaneApiError: class extends Error {},
  clearWorkspaceTokenOnAuthError: clearWorkspaceTokenOnAuthErrorMock,
  USERS_ME_PATH: '/api/v1/users/me/',
  toViewer: () => ({ id: '', displayName: 'Plane user', email: null })
}))

vi.mock('./plane-workspace-store', () => ({
  getCachedViewer: getCachedViewerMock,
  setCachedViewer: setCachedViewerMock,
  getPlaneWorkspaceId: (baseUrl: string, workspaceSlug: string) => `${baseUrl}\n${workspaceSlug}`
}))

const CLIENT: PlaneClientForWorkspace = {
  baseUrl: 'https://api.plane.so',
  workspaceSlug: 'acme',
  headers: { 'x-api-key': 'key-acme', 'x-workspace-slug': 'acme' }
}

const ALPHA = { id: 'proj-1', identifier: 'ALPHA', name: 'Alpha Project' }
const ITEM_COUNT = 108
// The measured mean, so the fixture is the board rather than a caricature of it.
const DESCRIPTION = 'x'.repeat(1892)
const DESCRIPTION_HTML = `<div><p>${DESCRIPTION}</p></div>`

function rawWorkItem(sequenceId: number, extra: Record<string, unknown> = {}) {
  return {
    id: `wi-${sequenceId}`,
    project: 'proj-1',
    sequence_id: sequenceId,
    name: `Work item ${sequenceId}`,
    description_html: DESCRIPTION_HTML,
    priority: 'medium',
    state: { id: 'state-1', name: 'Todo', group: 'unstarted', sequence: 1 },
    labels: [],
    assignees: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...extra
  }
}

function board(extra: Record<string, unknown> = {}) {
  return {
    results: Array.from({ length: ITEM_COUNT }, (_unused, index) => rawWorkItem(index + 1, extra)),
    next_cursor: '',
    next_page_results: false
  }
}

function seedBoard(extra: Record<string, unknown> = {}): void {
  getClientsMock.mockReturnValue([CLIENT])
  planeRequestMock.mockImplementation(async (_client: PlaneClientForWorkspace, url: string) => {
    const { pathname } = new URL(url, 'http://placeholder')
    if (pathname.endsWith('/projects/')) {
      return { results: [ALPHA], next_cursor: '', next_page_results: false }
    }
    return board(extra)
  })
}

/** What the phone actually pays for: the serialized RPC result. */
function wireBytes(items: unknown): number {
  return JSON.stringify(items).length
}

beforeEach(() => {
  acquireMock.mockClear()
  releaseMock.mockClear()
  getClientsMock.mockReset()
  planeRequestMock.mockReset()
  getCachedViewerMock.mockReset()
  getCachedViewerMock.mockReturnValue(null)
  setCachedViewerMock.mockClear()
})

describe('what the Plane list costs on the wire', () => {
  it('cuts the payload roughly in half when the caller says it does not read descriptions', async () => {
    const { listWorkItems } = await import('./work-items')
    seedBoard()

    const full = await listWorkItems({ projectId: 'proj-1', filter: 'all', workspaceId: 'acme' })
    const lean = await listWorkItems({
      projectId: 'proj-1',
      filter: 'all',
      workspaceId: 'acme',
      omitDescription: true
    })

    expect(full).toHaveLength(ITEM_COUNT)
    expect(lean).toHaveLength(ITEM_COUNT)
    // A ratio, not a byte count: a hardcoded threshold goes stale the moment any
    // other field changes, and would then pass on a payload that grew back.
    expect(wireBytes(lean) / wireBytes(full)).toBeLessThan(0.5)
  })

  it('keeps saving when another field grows, because the claim is about description', async () => {
    const { listWorkItems } = await import('./work-items')
    // A second heavy field the row does not render either. The ratio must still
    // hold: if this case fails, the assertion above was a byte count in disguise.
    seedBoard({ name: 'y'.repeat(2_000) })

    const full = await listWorkItems({ projectId: 'proj-1', filter: 'all', workspaceId: 'acme' })
    const lean = await listWorkItems({
      projectId: 'proj-1',
      filter: 'all',
      workspaceId: 'acme',
      omitDescription: true
    })

    expect(wireBytes(lean)).toBeLessThan(wireBytes(full))
    expect(wireBytes(full) - wireBytes(lean)).toBeGreaterThan(ITEM_COUNT * 1_800)
  })

  it('still sends the full item to a caller that does not ask, so old clients are untouched', async () => {
    const { listWorkItems } = await import('./work-items')
    seedBoard()

    const items = await listWorkItems({ projectId: 'proj-1', filter: 'all', workspaceId: 'acme' })

    // The wire-compat half: dropping a field reaches old readers with no schema
    // change, so absence of the flag has to mean the payload they expect.
    expect(items.every((item) => item.description === DESCRIPTION)).toBe(true)
  })

  it('drops the key rather than blanking it, so the saving is real', async () => {
    const { listWorkItems } = await import('./work-items')
    seedBoard()

    const [item] = await listWorkItems({
      projectId: 'proj-1',
      filter: 'all',
      workspaceId: 'acme',
      omitDescription: true
    })

    // `description: ''` would still serialize, and would read as "no description".
    expect(item && 'description' in item).toBe(false)
  })
})
