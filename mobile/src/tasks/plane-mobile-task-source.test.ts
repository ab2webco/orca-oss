import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  fetchPlaneProjects,
  readPlaneAvailability,
  fetchPlaneStates,
  fetchPlaneStatus,
  fetchPlaneWorkItems,
  isPlaneSupportedByHost,
  MOBILE_TASKS_PLANE_CAPABILITY,
  PLANE_WORK_ITEM_LIMIT
} from './plane-mobile-task-source'

type Call = { method: string; params?: unknown }

function stubClient(result: unknown, calls: Call[]): RpcClient {
  return {
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      return { id: '1', ok: true as const, result, _meta: { runtimeId: 'r' } }
    })
  } as unknown as RpcClient
}

function failingClient(message: string): RpcClient {
  return {
    sendRequest: vi.fn(async () => ({
      id: '1',
      ok: false as const,
      error: { code: 'method_not_allowed', message },
      _meta: { runtimeId: 'r' }
    }))
  } as unknown as RpcClient
}

describe('plane mobile task source', () => {
  it('gates the source on the host capability', () => {
    expect(isPlaneSupportedByHost(['mobile.tasks.v1'])).toBe(false)
    expect(isPlaneSupportedByHost(['mobile.tasks.v1', MOBILE_TASKS_PLANE_CAPABILITY])).toBe(true)
    expect(isPlaneSupportedByHost(undefined)).toBe(false)
  })

  it('skips the status read entirely on a host without the capability', async () => {
    const sendPlaneStatus = vi.fn()
    expect(await readPlaneAvailability(['mobile.tasks.v1'], sendPlaneStatus)).toEqual({
      supported: false,
      connected: false,
      status: null
    })
    expect(sendPlaneStatus).not.toHaveBeenCalled()
  })

  it('reads the connection when the host advertises the capability', async () => {
    const calls: Call[] = []
    const client = stubClient({ connected: true, workspaces: [{ id: 'w1' }] }, calls)
    const availability = await readPlaneAvailability(
      ['mobile.tasks.v1', MOBILE_TASKS_PLANE_CAPABILITY],
      () => client.sendRequest('plane.status')
    )
    expect(calls.map((call) => call.method)).toEqual(['plane.status'])
    expect(availability.supported).toBe(true)
    expect(availability.connected).toBe(true)
    expect(availability.status?.workspaces[0]?.id).toBe('w1')
  })

  it('reports a supported host whose Plane is disconnected', async () => {
    const calls: Call[] = []
    const client = stubClient({ connected: false }, calls)
    expect(
      await readPlaneAvailability([MOBILE_TASKS_PLANE_CAPABILITY], () =>
        client.sendRequest('plane.status')
      )
    ).toMatchObject({ supported: true, connected: false })
  })

  it('degrades to disconnected when the status read fails or is malformed', async () => {
    const failing = failingClient('plane is unreachable')
    expect(
      await readPlaneAvailability([MOBILE_TASKS_PLANE_CAPABILITY], () =>
        failing.sendRequest('plane.status')
      )
    ).toEqual({ supported: true, connected: false, status: null })

    const malformed = stubClient('not an object', [])
    expect(
      await readPlaneAvailability([MOBILE_TASKS_PLANE_CAPABILITY], () =>
        malformed.sendRequest('plane.status')
      )
    ).toEqual({ supported: true, connected: false, status: null })
  })

  it('lists whatever the query is, because the search endpoint only parses PQL', async () => {
    const calls: Call[] = []
    const client = stubClient([], calls)
    await fetchPlaneWorkItems(client, {
      query: '   ',
      filter: 'assigned',
      projectId: 'p1',
      workspaceId: 'w1'
    })
    await fetchPlaneWorkItems(client, {
      query: ' 169 ',
      filter: 'assigned',
      projectId: null,
      workspaceId: null
    })
    // ORCA-416: free text reached plane.searchWorkItems and came back as a parse error.
    expect(calls.map((call) => call.method)).toEqual(['plane.listWorkItems', 'plane.listWorkItems'])
    expect(calls[0]?.params).toEqual({
      filter: 'assigned',
      projectId: 'p1',
      workspaceId: 'w1'
    })
    expect(calls[1]?.params).toEqual({
      filter: 'assigned',
      projectId: undefined,
      workspaceId: undefined
    })
  })

  it('narrows the listed rows to the card a human searched for, by number or title', async () => {
    const calls: Call[] = []
    const rows = [
      { id: 'wi-1', identifier: 'ORCA-169', title: 'The mobile search', url: '' },
      { id: 'wi-2', identifier: 'ORCA-417', title: 'Board spinner', url: '' }
    ]
    const found = await fetchPlaneWorkItems(stubClient(rows, calls), {
      query: '169',
      filter: 'all',
      projectId: 'p1',
      workspaceId: 'w1'
    })
    expect(found.map((item) => item.id)).toEqual(['wi-1'])

    const byTitle = await fetchPlaneWorkItems(stubClient(rows, calls), {
      query: 'spinner',
      filter: 'all',
      projectId: 'p1',
      workspaceId: 'w1'
    })
    expect(byTitle.map((item) => item.id)).toEqual(['wi-2'])
  })

  it('matches before the row cap, so a hit past the hundredth row is still findable', async () => {
    const calls: Call[] = []
    const rows = [
      ...Array.from({ length: PLANE_WORK_ITEM_LIMIT }, (_unused, index) => ({
        id: `filler-${index}`,
        identifier: `ORCA-${index}`,
        title: 'Filler',
        url: ''
      })),
      { id: 'wi-late', identifier: 'ORCA-4210', title: 'Last of the list', url: '' }
    ]
    const found = await fetchPlaneWorkItems(stubClient(rows, calls), {
      query: '4210',
      filter: 'all',
      projectId: 'p1',
      workspaceId: 'w1'
    })
    expect(found.map((item) => item.id)).toEqual(['wi-late'])
  })

  it('surfaces the host error rather than an empty list', async () => {
    await expect(
      fetchPlaneWorkItems(failingClient('method not allowed for this client'), {
        query: '',
        filter: 'all',
        projectId: null,
        workspaceId: null
      })
    ).rejects.toThrow('method not allowed for this client')
  })

  it('hides archived projects from the scope picker', async () => {
    const calls: Call[] = []
    const client = stubClient(
      [
        { id: 'p1', identifier: 'ORCA', name: 'Orca Lab' },
        { id: 'p2', identifier: 'OLD', name: 'Retired', archived: true }
      ],
      calls
    )
    expect((await fetchPlaneProjects(client, 'w1')).map((project) => project.id)).toEqual(['p1'])
  })

  it('reads status and per-project states', async () => {
    const calls: Call[] = []
    expect((await fetchPlaneStatus(stubClient({ connected: true }, calls))).connected).toBe(true)
    await fetchPlaneStates(stubClient([], calls), 'p1', null)
    expect(calls.map((call) => call.method)).toEqual(['plane.status', 'plane.listStates'])
    expect(calls[1]?.params).toEqual({ projectId: 'p1', workspaceId: undefined })
  })
})
