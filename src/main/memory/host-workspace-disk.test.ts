import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { readWorkspaceDisk } from './host-workspace-disk'

const statsOf = (blocks: number, bavail: number) => ({ bsize: 4096, blocks, bavail })
const missing = (): never => {
  throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
}

describe('readWorkspaceDisk', () => {
  it('reads the total and the space this user can still write in the workspaces folder', async () => {
    const statfs = vi.fn(async () => statsOf(1_000, 250))

    expect(await readWorkspaceDisk('/home/me/orca/workspaces', statfs)).toEqual({
      total: 4096 * 1_000,
      free: 4096 * 250
    })
    expect(statfs).toHaveBeenCalledWith('/home/me/orca/workspaces')
  })

  it('reads the nearest folder that exists when the workspaces folder is not made yet', async () => {
    const dir = path.join(path.sep, 'home', 'me', 'orca', 'workspaces')
    const statfs = vi.fn(async (at: string) =>
      at === path.join(path.sep, 'home', 'me') ? statsOf(10, 5) : missing()
    )

    expect(await readWorkspaceDisk(dir, statfs)).toEqual({ total: 40_960, free: 20_480 })
  })

  it('is none when the disk cannot be read', async () => {
    const statfs = vi.fn(async () => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    })

    expect(await readWorkspaceDisk('/srv/orca', statfs)).toBeNull()
    expect(await readWorkspaceDisk('/srv/orca', async () => statsOf(0, 0))).toBeNull()
  })
})
