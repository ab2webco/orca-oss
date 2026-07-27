import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  createWorkItem: vi.fn(),
  deleteWorkItem: vi.fn(),
  createPlaneState: vi.fn(),
  updatePlaneState: vi.fn(),
  deletePlaneState: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../plane/plane-work-item-create', () => ({ createWorkItem: mocks.createWorkItem }))
vi.mock('../plane/plane-work-item-delete', () => ({ deleteWorkItem: mocks.deleteWorkItem }))
vi.mock('../plane/plane-work-item-writes', () => ({
  createPlaneState: mocks.createPlaneState,
  updatePlaneState: mocks.updatePlaneState,
  deletePlaneState: mocks.deletePlaneState
}))

// Why unmocked: the broadcast is the contract under test — a delete that does
// not announce itself leaves every open board stale.
import { attachPlaneChangeBroadcast } from '../plane/plane-change-broadcast'
import { registerPlaneBoardStateHandlers } from './plane-board-state-ipc'

type IpcHandler = (event: unknown, args: unknown) => Promise<unknown>

function getHandler(channel: string): IpcHandler {
  const call = mocks.handle.mock.calls.find(([name]) => name === channel)
  if (!call) {
    throw new Error(`No handler registered for ${channel}`)
  }
  return call[1] as IpcHandler
}

function fakeWindow(): {
  isDestroyed: () => boolean
  webContents: { send: ReturnType<typeof vi.fn> }
} {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } }
}

beforeEach(() => {
  vi.clearAllMocks()
  registerPlaneBoardStateHandlers()
})

afterEach(() => {
  attachPlaneChangeBroadcast(null)
})

describe('plane:deleteWorkItem', () => {
  it('registers the channel', () => {
    expect(mocks.handle.mock.calls.map(([name]) => name)).toContain('plane:deleteWorkItem')
  })

  it('rejects a missing project without touching Plane', async () => {
    const result = await getHandler('plane:deleteWorkItem')({}, { workItemId: 'wi-1' })

    expect(result).toEqual({ ok: false, error: 'Project is required.' })
    expect(mocks.deleteWorkItem).not.toHaveBeenCalled()
  })

  it('rejects a missing work item id without touching Plane', async () => {
    const result = await getHandler('plane:deleteWorkItem')({}, { projectId: 'project-1' })

    expect(result).toEqual({ ok: false, error: 'Work item ID is required.' })
    expect(mocks.deleteWorkItem).not.toHaveBeenCalled()
  })

  it('trims args, deletes, and announces the change to open views', async () => {
    const window = fakeWindow()
    attachPlaneChangeBroadcast(window as never)
    mocks.deleteWorkItem.mockResolvedValue({ ok: true })

    const result = await getHandler('plane:deleteWorkItem')(
      {},
      { projectId: ' project-1 ', workItemId: ' wi-1 ', workspaceId: 'ws-1' }
    )

    expect(result).toEqual({ ok: true })
    expect(mocks.deleteWorkItem).toHaveBeenCalledWith({
      projectId: 'project-1',
      workItemId: 'wi-1',
      workspaceId: 'ws-1'
    })
    expect(window.webContents.send).toHaveBeenCalledWith('plane:changed', {
      method: 'plane:deleteWorkItem',
      projectId: 'project-1'
    })
  })

  it('returns the rejection untouched and announces nothing', async () => {
    // Why: a failed delete changed nothing — announcing it would refetch every
    // open view for no reason, and hiding the error would fake a success.
    const window = fakeWindow()
    attachPlaneChangeBroadcast(window as never)
    mocks.deleteWorkItem.mockResolvedValue({ ok: false, error: 'Work item was already deleted.' })

    const result = await getHandler('plane:deleteWorkItem')(
      {},
      { projectId: 'project-1', workItemId: 'wi-1' }
    )

    expect(result).toEqual({ ok: false, error: 'Work item was already deleted.' })
    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})
