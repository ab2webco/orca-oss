import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachPlaneChangeBroadcast,
  broadcastPlaneChange,
  isPlaneMutationMethod,
  resolveChangedProjectId,
  withPlaneChangeBroadcast
} from './plane-change-broadcast'

vi.mock('electron', () => ({}))

type FakeWindow = {
  isDestroyed: () => boolean
  webContents: { send: ReturnType<typeof vi.fn> }
}

function fakeWindow(destroyed = false): FakeWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() }
  }
}

afterEach(() => {
  attachPlaneChangeBroadcast(null)
})

describe('isPlaneMutationMethod', () => {
  it('announces the mutations that change what a Plane view renders', () => {
    for (const method of [
      'plane.createWorkItem',
      'plane.updateWorkItem',
      'plane.deleteWorkItem',
      'plane.addWorkItemComment',
      'plane.deleteWorkItemComment',
      'plane.createState',
      'plane.updateState',
      'plane.deleteState',
      'plane.addPlanningWorkItems'
    ]) {
      expect(isPlaneMutationMethod(method)).toBe(true)
    }
  })

  it('stays silent for reads', () => {
    // Why: a listing that announced itself would trigger the refetch that lists
    // again — an endless loop on every board render.
    for (const method of [
      'plane.listWorkItems',
      'plane.getWorkItem',
      'plane.searchWorkItems',
      'plane.listStates',
      'plane.status',
      'plane.listPlanningWorkItems'
    ]) {
      expect(isPlaneMutationMethod(method)).toBe(false)
    }
  })

  it('stays silent for unrelated RPC methods', () => {
    expect(isPlaneMutationMethod('terminal.send')).toBe(false)
    expect(isPlaneMutationMethod('')).toBe(false)
  })
})

describe('resolveChangedProjectId', () => {
  it('reads the project a scoped mutation targeted', () => {
    expect(resolveChangedProjectId({ projectId: 'project-1' })).toBe('project-1')
  })

  it('degrades to workspace-wide for params it cannot trust', () => {
    // Why: params arrive from the CLI and paired clients, so a missing or
    // wrong-typed projectId must not throw — a null means "refetch anyway".
    expect(resolveChangedProjectId(undefined)).toBeNull()
    expect(resolveChangedProjectId(null)).toBeNull()
    expect(resolveChangedProjectId('not-an-object')).toBeNull()
    expect(resolveChangedProjectId({})).toBeNull()
    expect(resolveChangedProjectId({ projectId: 42 })).toBeNull()
    expect(resolveChangedProjectId({ projectId: '' })).toBeNull()
  })
})

describe('broadcastPlaneChange', () => {
  it('sends the change to the attached window', () => {
    const window = fakeWindow()
    attachPlaneChangeBroadcast(window as never)

    broadcastPlaneChange({ method: 'plane.updateWorkItem', projectId: 'project-1' })

    expect(window.webContents.send).toHaveBeenCalledWith('plane:changed', {
      method: 'plane.updateWorkItem',
      projectId: 'project-1'
    })
  })

  it('does nothing when no window is attached', () => {
    expect(() =>
      broadcastPlaneChange({ method: 'plane.updateWorkItem', projectId: null })
    ).not.toThrow()
  })

  it('skips a destroyed window instead of throwing', () => {
    const window = fakeWindow(true)
    attachPlaneChangeBroadcast(window as never)

    broadcastPlaneChange({ method: 'plane.updateWorkItem', projectId: null })

    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('swallows a send failure so the completed mutation still succeeds', () => {
    const window = fakeWindow()
    window.webContents.send.mockImplementation(() => {
      throw new Error('render frame disposed')
    })
    attachPlaneChangeBroadcast(window as never)

    expect(() =>
      broadcastPlaneChange({ method: 'plane.createWorkItem', projectId: 'project-1' })
    ).not.toThrow()
  })
})

describe('withPlaneChangeBroadcast', () => {
  it('announces a successful IPC mutation', async () => {
    // Why this exists: the board writes through plane:* IPC channels, which never
    // reach the RPC dispatcher — a card created from a column was saved but no
    // view was told, so it only appeared after reopening the app.
    const window = fakeWindow()
    attachPlaneChangeBroadcast(window as never)

    const result = await withPlaneChangeBroadcast(
      'plane:createWorkItem',
      'project-1',
      async () => ({
        ok: true as const,
        id: 'wi-1'
      })
    )

    expect(result).toEqual({ ok: true, id: 'wi-1' })
    expect(window.webContents.send).toHaveBeenCalledWith('plane:changed', {
      method: 'plane:createWorkItem',
      projectId: 'project-1'
    })
  })

  it('stays silent when the write was rejected', async () => {
    // Why: a failed write changed nothing, so announcing it would make every open
    // view refetch for no reason.
    const window = fakeWindow()
    attachPlaneChangeBroadcast(window as never)

    await withPlaneChangeBroadcast('plane:createWorkItem', 'project-1', async () => ({
      ok: false as const,
      error: 'Project is required.'
    }))

    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('announces results that carry no ok flag', async () => {
    // Some writes resolve to plain data; absence of `ok` is not a failure.
    const window = fakeWindow()
    attachPlaneChangeBroadcast(window as never)

    await withPlaneChangeBroadcast('plane:updateState', 'project-1', async () => ({}))

    expect(window.webContents.send).toHaveBeenCalled()
  })

  it('lets the write error propagate without announcing', async () => {
    const window = fakeWindow()
    attachPlaneChangeBroadcast(window as never)

    await expect(
      withPlaneChangeBroadcast('plane:updateWorkItem', 'project-1', async () => {
        throw new Error('network down')
      })
    ).rejects.toThrow('network down')
    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})
