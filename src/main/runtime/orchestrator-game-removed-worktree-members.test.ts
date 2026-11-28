import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => userData.dir) }
}))

// Why: a Windows rename over a file a reader holds open fails with EPERM (ORCA-1442); Linux CI cannot provoke it.
const locks = vi.hoisted(() => ({ codes: [] as string[] }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return {
    ...actual,
    rename: async (source: string, target: string) => {
      const code = locks.codes.shift()
      if (!code) {
        return actual.rename(source, target)
      }
      throw Object.assign(new Error(`simulated ${code}`), { code })
    }
  }
})

import { OrcaRuntimeService } from './orca-runtime'
import type { GameMemberSessionStore } from './orchestrator-game-member-session-store'

// Why the cast: the saved-member store is private; the desktop delete reaches it only through this event.
const storeOf = (runtime: OrcaRuntimeService): GameMemberSessionStore =>
  (runtime as unknown as { gameMemberSessions: GameMemberSessionStore }).gameMemberSessions

const ticketsOf = async (store: GameMemberSessionStore): Promise<string[]> => {
  const read = await store.read('repo:repo-1')
  return read.ok ? read.members.map((one) => one.ticket) : []
}

async function runtimeWithTwoMembers(): Promise<{
  runtime: OrcaRuntimeService
  store: GameMemberSessionStore
}> {
  const runtime = new OrcaRuntimeService(null)
  const store = storeOf(runtime)
  for (const ticket of ['ORCA-1', 'ORCA-2']) {
    await store.upsert('repo:repo-1', {
      ticket,
      runId: 'run_1',
      taskId: `task_${ticket}`,
      worktreeId: `repo-1::/w/${ticket.toLowerCase()}`,
      lastState: 'idle'
    })
  }
  return { runtime, store }
}

const removeOrca1 = (runtime: OrcaRuntimeService): Promise<void> =>
  runtime.noteIpcWorktreeLifecycle({
    kind: 'removed',
    worktreeId: 'repo-1::/w/orca-1',
    path: '/w/orca-1'
  })

function withPlatform(platform: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  return () => {
    if (original) {
      Object.defineProperty(process, 'platform', original)
    }
  }
}

describe('a worktree removed from the desktop frees its paused member', () => {
  let restorePlatform: () => void = () => undefined

  beforeEach(() => {
    userData.dir = mkdtempSync(join(tmpdir(), 'orca-removed-worktree-members-'))
    locks.codes = []
  })

  afterEach(() => {
    restorePlatform()
    restorePlatform = () => undefined
    vi.restoreAllMocks()
    rmSync(userData.dir, { recursive: true, force: true })
  })

  it('drops the member saved for that worktree and keeps the others', async () => {
    const warn = vi.spyOn(console, 'warn')
    const { runtime, store } = await runtimeWithTwoMembers()

    await runtime.noteIpcWorktreeLifecycle({
      kind: 'created',
      worktreeId: 'repo-1::/w/orca-2',
      path: '/w/orca-2',
      branch: 'orca-2'
    })
    await removeOrca1(runtime)

    expect(warn.mock.calls).toEqual([])
    expect(await ticketsOf(store)).toEqual(['ORCA-2'])
  })

  it('still drops it on Windows when a reader holds the members file during the rename', async () => {
    restorePlatform = withPlatform('win32')
    const { runtime, store } = await runtimeWithTwoMembers()
    locks.codes = ['EPERM', 'EBUSY']

    await removeOrca1(runtime)

    expect(locks.codes).toEqual([])
    expect(await ticketsOf(store)).toEqual(['ORCA-2'])
  })

  it('logs a removal it could not save instead of dropping the error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { runtime } = await runtimeWithTwoMembers()
    const dir = join(userData.dir, 'orchestrator-game-members')
    for (const name of readdirSync(dir)) {
      writeFileSync(join(dir, name), 'not json', 'utf-8')
    }

    await removeOrca1(runtime)

    expect(warn).toHaveBeenCalledWith(
      '[orchestrator-game] the removed worktree did not free its members',
      expect.objectContaining({
        worktreeId: 'repo-1::/w/orca-1',
        errors: [expect.stringContaining('damaged')]
      })
    )
  })
})
