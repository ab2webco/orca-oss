import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

userData.dir = mkdtempSync(join(tmpdir(), 'orca-member-hold-'))
const repoDir = mkdtempSync(join(tmpdir(), 'orca-member-hold-repo-'))
afterAll(() => {
  rmSync(userData.dir, { recursive: true, force: true })
  rmSync(repoDir, { recursive: true, force: true })
})

const git = (...args: string[]): void => {
  execFileSync('git', args, { cwd: repoDir, stdio: 'ignore' })
}

// Why the casts: the removal target and the member store are private runtime internals.
function runtimeFor(worktreeId: string): OrcaRuntimeService {
  const runtime = new OrcaRuntimeService(null)
  const internals = runtime as unknown as {
    resolveWorktreeRemovalTarget: (selector: string) => Promise<unknown>
  }
  vi.spyOn(internals, 'resolveWorktreeRemovalTarget').mockResolvedValue({
    id: worktreeId,
    repoId: 'repo-1',
    path: repoDir
  })
  return runtime
}

const storeOf = (runtime: OrcaRuntimeService): GameMemberSessionStore =>
  (runtime as unknown as { gameMemberSessions: GameMemberSessionStore }).gameMemberSessions

describe('OrcaRuntimeService.gameMemberWorktreeHold (ORCA-746)', () => {
  it("reads the saved member and lists its worktree's commits no remote has", async () => {
    git('init', '-q')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    writeFileSync(join(repoDir, 'a.txt'), 'a')
    git('add', 'a.txt')
    git('commit', '-q', '-m', 'feat: queued setups')
    const runtime = runtimeFor('wt-1')
    await storeOf(runtime).upsert('repo:repo-1', {
      ticket: 'ORCA-2',
      name: 'Merlin · ORCA-2',
      runId: 'run_1',
      taskId: 'task_ORCA-2',
      worktreeId: 'wt-1',
      lastState: 'working'
    })

    const hold = await runtime.gameMemberWorktreeHold('id:wt-1')

    expect(hold).toMatchObject({ ticket: 'ORCA-2', name: 'Merlin · ORCA-2', lastState: 'working' })
    expect(hold?.unpushed).toEqual([expect.stringMatching(/^[0-9a-f]{7,} feat: queued setups$/)])
    expect(await runtimeFor('wt-other').gameMemberWorktreeHold('id:wt-other')).toBeNull()
  })
})
