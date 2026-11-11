import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => userData.dir) }
}))

import { OrcaRuntimeService } from './orca-runtime'
import type { GameMemberSessionStore } from './orchestrator-game-member-session-store'

userData.dir = mkdtempSync(join(tmpdir(), 'orca-removed-worktree-members-'))
afterAll(() => rmSync(userData.dir, { recursive: true, force: true }))

// Why the cast: the saved-member store is private; the desktop delete reaches it only through this event.
const storeOf = (runtime: OrcaRuntimeService): GameMemberSessionStore =>
  (runtime as unknown as { gameMemberSessions: GameMemberSessionStore }).gameMemberSessions

const ticketsOf = async (store: GameMemberSessionStore): Promise<string[]> => {
  const read = await store.read('repo:repo-1')
  return read.ok ? read.members.map((one) => one.ticket) : []
}

describe('a worktree removed from the desktop frees its paused member', () => {
  it('drops the member saved for that worktree and keeps the others', async () => {
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

    runtime.noteIpcWorktreeLifecycle({
      kind: 'created',
      worktreeId: 'repo-1::/w/orca-2',
      path: '/w/orca-2',
      branch: 'orca-2'
    })
    runtime.noteIpcWorktreeLifecycle({
      kind: 'removed',
      worktreeId: 'repo-1::/w/orca-1',
      path: '/w/orca-1'
    })

    await vi.waitFor(async () => expect(await ticketsOf(store)).toEqual(['ORCA-2']))
  })
})
