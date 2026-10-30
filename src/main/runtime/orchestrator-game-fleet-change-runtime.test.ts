import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => userData.dir) }
}))

import { OrcaRuntimeService } from './orca-runtime'

userData.dir = mkdtempSync(join(tmpdir(), 'orca-fleet-change-runtime-'))
afterAll(() => rmSync(userData.dir, { recursive: true, force: true }))
afterEach(() => {
  vi.useRealTimers()
})

// Why the casts: these paths are private, and real ones need a git repo, live PTYs and hook events.
type Internals = {
  notifyWorktreesChanged: (repoId: string) => void
  retainAgentRowSnapshot: (
    ptyId: string,
    paneKey: string,
    worktreeId: string | undefined,
    tabId: string | undefined,
    connectionId: string | null,
    payload: { state: string; prompt: string; agentType?: string }
  ) => boolean
  clearAgentRowSnapshotsForPty: (ptyId: string) => void
  gameBoardProjectOf: () => Promise<{ key: string; isMember: boolean }>
  gamePausedMembers: { record: () => Promise<void>; forget: () => Promise<void> }
  gameMemberResume: { resume: () => Promise<unknown>; discard: () => Promise<unknown> }
  gameHistory: { append: () => Promise<unknown[]> }
}

function leadRuntime(): { runtime: OrcaRuntimeService; internals: Internals } {
  const runtime = new OrcaRuntimeService(null)
  const internals = runtime as unknown as Internals
  vi.spyOn(internals, 'gameBoardProjectOf').mockResolvedValue({
    key: 'repo:repo-1',
    isMember: false
  })
  vi.spyOn(internals.gamePausedMembers, 'record').mockResolvedValue(undefined)
  vi.spyOn(internals.gamePausedMembers, 'forget').mockResolvedValue(undefined)
  vi.spyOn(internals.gameMemberResume, 'resume').mockResolvedValue({ resumed: true })
  vi.spyOn(internals.gameMemberResume, 'discard').mockResolvedValue({
    discarded: [],
    setAside: null
  })
  vi.spyOn(internals.gameHistory, 'append').mockResolvedValue([])
  return { runtime, internals }
}

/** How many fleet versions `act` moved, once the 250 ms burst window closed. */
async function fleetChangesOf(runtime: OrcaRuntimeService, act: () => unknown): Promise<number> {
  vi.useFakeTimers()
  const { version: before } = await runtime.waitGameFleetChange({ timeoutMs: 1 })
  await act()
  await vi.advanceTimersByTimeAsync(250)
  const { version: after } = await runtime.waitGameFleetChange({ timeoutMs: 1 })
  return after - before
}

const status = (state: string, prompt = '') => ({ state, prompt, agentType: 'claude' })

describe('game fleet changes, through the runtime', () => {
  it('moves the fleet version when a worktree is created or removed (launch, release, sweep --close)', async () => {
    const { runtime, internals } = leadRuntime()

    expect(await fleetChangesOf(runtime, () => internals.notifyWorktreesChanged('repo-1'))).toBe(1)
  })

  it("moves it when a member's agent changes state, and not on a tool or prompt ping", async () => {
    const { runtime, internals } = leadRuntime()
    const retain = (payload: ReturnType<typeof status>) =>
      internals.retainAgentRowSnapshot('pty-1', 'tab-4:member', 'wt-member', 'tab-4', null, payload)

    expect(await fleetChangesOf(runtime, () => retain(status('working')))).toBe(1)
    expect(await fleetChangesOf(runtime, () => retain(status('working', 'next step')))).toBe(0)
    expect(await fleetChangesOf(runtime, () => retain(status('waiting')))).toBe(1)
  })

  it("moves it when a member's terminal goes away (stop, abandon)", async () => {
    const { runtime, internals } = leadRuntime()
    await fleetChangesOf(runtime, () =>
      internals.retainAgentRowSnapshot('pty-1', 'tab-4:member', 'wt-member', 'tab-4', null, {
        state: 'working',
        prompt: ''
      })
    )

    expect(
      await fleetChangesOf(runtime, () => internals.clearAgentRowSnapshotsForPty('pty-1'))
    ).toBe(1)
  })

  it('moves it on orchestration mail, which moves a member through its phases', async () => {
    const { runtime } = leadRuntime()

    expect(
      await fleetChangesOf(runtime, () => runtime.notifyMessageArrived('term_lead', 'worker_done'))
    ).toBe(1)
  })

  it('moves it when the lead saves, frees, resumes or discards a member', async () => {
    const { runtime } = leadRuntime()
    const caller = { worktreeId: 'wt-lead' }

    expect(
      await fleetChangesOf(runtime, () =>
        runtime.recordGameMember({ ...caller, member: { ticket: 'ORCA-1' } })
      )
    ).toBe(1)
    expect(
      await fleetChangesOf(runtime, () =>
        runtime.recordGameHistory({
          ...caller,
          record: { ticket: 'ORCA-1', outcome: 'merged', at: '2026-10-30T00:00:00Z' } as never
        })
      )
    ).toBe(1)
    expect(
      await fleetChangesOf(runtime, () => runtime.resumeGameMember({ ...caller, ticket: 'ORCA-1' }))
    ).toBe(1)
    expect(
      await fleetChangesOf(runtime, () =>
        runtime.discardGameMembers({ ...caller, tickets: ['ORCA-1'] })
      )
    ).toBe(1)
  })

  it('counts a launch, which creates a worktree, a terminal and a record at once, as one change', async () => {
    const { runtime, internals } = leadRuntime()

    expect(
      await fleetChangesOf(runtime, async () => {
        internals.notifyWorktreesChanged('repo-1')
        internals.retainAgentRowSnapshot('pty-2', 'tab-5:member', 'wt-2', 'tab-5', null, {
          state: 'working',
          prompt: ''
        })
        await runtime.recordGameMember({ worktreeId: 'wt-lead', member: { ticket: 'ORCA-2' } })
      })
    ).toBe(1)
  })
})
