/** ORCA-1478: removing a repo or folder workspace from the desktop retires its Agent Teams members. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, mockStore, order } = vi.hoisted(() => {
  const order: string[] = []
  return {
    order,
    handleMock: vi.fn(),
    mockStore: {
      getRepos: vi.fn(),
      getRepo: vi.fn(),
      removeProject: vi.fn(() => order.push('removeProject')),
      removeProjectForHost: vi.fn(() => order.push('removeProjectForHost')),
      removeFolderWorkspace: vi.fn(() => true)
    }
  }
})

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: handleMock, removeHandler: vi.fn() }
}))
vi.mock('./registered-worktree-roots-cache', () => ({ invalidateAuthorizedRootsCache: vi.fn() }))
vi.mock('../providers/ssh-git-dispatch', () => ({ getSshGitProvider: vi.fn() }))
vi.mock('./ssh', () => ({ getActiveMultiplexer: vi.fn() }))

const handlers = new Map<string, (_event: unknown, args: unknown) => unknown>()
const mainWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } }
const retireGameWorkspace = vi.fn(async (removal: unknown) => {
  order.push(`retire ${JSON.stringify(removal)}`)
})

beforeEach(async () => {
  handlers.clear()
  order.length = 0
  retireGameWorkspace.mockClear()
  handleMock.mockReset()
  handleMock.mockImplementation((channel: string, handler: (...a: unknown[]) => unknown) => {
    handlers.set(channel, handler)
  })
  vi.resetModules()
  const repos = await import('./repos')
  repos.registerRepoHandlers(mainWindow as never, mockStore as never)
  repos.setRepoRemoteClientNotifier({
    notifyReposChangedForRemoteClients: vi.fn(),
    retireGameWorkspace
  } as never)
})

const sshRepo = (hostId: string) => ({ id: 'repo-1', path: '/srv/app', executionHostId: hostId })

describe('desktop removal retires the Agent Teams members it held', () => {
  // Why first: the game files are named by the repo's place, which the removal forgets.
  it('retires a removed repo before the store forgets it', async () => {
    await handlers.get('repos:remove')!(null, { repoId: 'repo-1' })

    expect(order).toEqual(['retire {"repoId":"repo-1"}', 'removeProject'])
  })

  it('retires an SSH project forgotten on its last host', async () => {
    mockStore.getRepos.mockReturnValue([sshRepo('ssh:box')])

    await handlers.get('repos:removeForHost')!(null, { repoId: 'repo-1', hostId: 'ssh:box' })

    expect(order).toEqual(['retire {"repoId":"repo-1"}', 'removeProjectForHost'])
  })

  it('leaves the members alone while another host still has the same repo id', async () => {
    mockStore.getRepos.mockReturnValue([sshRepo('ssh:box'), sshRepo('local')])

    await handlers.get('repos:removeForHost')!(null, { repoId: 'repo-1', hostId: 'ssh:box' })

    expect(order).toEqual(['removeProjectForHost'])
  })

  it('retires a deleted folder workspace by its workspace key', async () => {
    expect(
      await handlers.get('folderWorkspaces:delete')!(null, { folderWorkspaceId: 'fw-1' })
    ).toBe(true)

    expect(retireGameWorkspace).toHaveBeenCalledWith({ worktreeId: 'folder:fw-1' })
  })
})
