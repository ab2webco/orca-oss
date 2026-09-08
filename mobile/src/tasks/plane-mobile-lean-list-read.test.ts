import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  fetchPlaneWorkItemDescription,
  fetchPlaneWorkItems,
  isPlaneWorkItemDescriptionReadableByHost,
  MOBILE_PLANE_WORK_ITEM_DESCRIPTION_CAPABILITY,
  MOBILE_TASKS_PLANE_CAPABILITY
} from './plane-mobile-task-source'

/**
 * ORCA-464 on the phone. The saving is only safe where the detail can read the
 * description back, so the capability gates the ASK — a host that predates it
 * must keep receiving the request it has always answered, with the field in it.
 */
type Call = { method: string; params?: unknown }

function stubClient(result: unknown, calls: Call[]): RpcClient {
  return {
    sendRequest: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      return { id: '1', ok: true as const, result, _meta: { runtimeId: 'r' } }
    })
  } as unknown as RpcClient
}

const NEW_HOST = [MOBILE_TASKS_PLANE_CAPABILITY, MOBILE_PLANE_WORK_ITEM_DESCRIPTION_CAPABILITY]
const OLD_HOST = [MOBILE_TASKS_PLANE_CAPABILITY]

function rawItem(description?: string) {
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
    createdAt: '2026-01-01T00:00:00Z',
    ...(description === undefined ? {} : { description })
  }
}

describe('what the phone asks the list for', () => {
  it('asks for the lean list where the detail can read the description back', async () => {
    const calls: Call[] = []
    await fetchPlaneWorkItems(stubClient([rawItem()], calls), {
      query: '',
      filter: 'everything',
      projectId: 'proj-1',
      workspaceId: 'ws-1',
      capabilities: NEW_HOST
    })

    expect(calls[0]?.method).toBe('plane.listWorkItems')
    expect(calls[0]?.params).toMatchObject({ omitDescription: true })
  })

  it('says nothing to a host that predates the flag, so its answer is unchanged', async () => {
    // The wire-compat half. Such a host allowlists no plane.getWorkItem, so a
    // lean list would leave every card body blank with nothing able to fill it.
    const calls: Call[] = []
    await fetchPlaneWorkItems(stubClient([rawItem('body')], calls), {
      query: '',
      filter: 'everything',
      projectId: 'proj-1',
      workspaceId: 'ws-1',
      capabilities: OLD_HOST
    })

    expect(calls[0]?.params).not.toHaveProperty('omitDescription')
  })

  it('asks for the full list when it does not know the host yet', async () => {
    const calls: Call[] = []
    await fetchPlaneWorkItems(stubClient([rawItem('body')], calls), {
      query: '',
      filter: 'everything',
      projectId: 'proj-1',
      workspaceId: 'ws-1'
    })

    expect(calls[0]?.params).not.toHaveProperty('omitDescription')
  })

  it('reads the capability as the one fact it stands for', () => {
    expect(isPlaneWorkItemDescriptionReadableByHost(NEW_HOST)).toBe(true)
    expect(isPlaneWorkItemDescriptionReadableByHost(OLD_HOST)).toBe(false)
    expect(isPlaneWorkItemDescriptionReadableByHost(undefined)).toBe(false)
  })
})

describe('reading one description on open', () => {
  it('reads it through plane.getWorkItem, scoped to the card project', async () => {
    const calls: Call[] = []
    const client = stubClient(rawItem('## Steps\n1. retry'), calls)

    const text = await fetchPlaneWorkItemDescription(client, {
      workItemId: 'wi-1',
      projectId: 'proj-1',
      workspaceId: 'ws-1'
    })

    expect(calls[0]).toEqual({
      method: 'plane.getWorkItem',
      params: { workItemId: 'wi-1', projectId: 'proj-1', workspaceId: 'ws-1' }
    })
    expect(text).toBe('## Steps\n1. retry')
  })

  it("answers '' for a card that really has none, rather than throwing", async () => {
    // On the lean path an absent field can mean either "omitted" or "empty", so
    // the read is what decides — and only this side can tell the two apart.
    const text = await fetchPlaneWorkItemDescription(stubClient(rawItem(), []), {
      workItemId: 'wi-1',
      projectId: 'proj-1',
      workspaceId: null
    })

    expect(text).toBe('')
  })

  it('throws rather than answering empty when the row cannot be read', async () => {
    await expect(
      fetchPlaneWorkItemDescription(stubClient({ nonsense: true }, []), {
        workItemId: 'wi-1',
        projectId: 'proj-1',
        workspaceId: null
      })
    ).rejects.toThrow(/could not read/i)
  })
})
