import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameMemberSessionStore } from './orchestrator-game-member-session-store'
import { GamePausedMembers } from './orchestrator-game-paused-members'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function setup(goneWorktrees: ReadonlySet<string>) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-paused-gone-'))
  dirs.push(dir)
  const store = new GameMemberSessionStore(
    () => dir,
    () => '2026-11-11T10:00:00.000Z'
  )
  const paused = new GamePausedMembers({
    store,
    contextOf: () => undefined,
    sessionIdOf: () => null,
    worktreeGone: async (worktreeId) => goneWorktrees.has(worktreeId)
  })
  return { store, paused }
}

const saved = (ticket: string, worktreeId: string) => ({
  ticket,
  name: `Merlin · ${ticket}`,
  runId: 'run_1',
  taskId: `task_${ticket}`,
  worktreeId,
  lastState: 'idle'
})

const ticketsOf = async (store: GameMemberSessionStore): Promise<string[]> => {
  const read = await store.read('repo:a')
  return read.ok ? read.members.map((one) => one.ticket) : []
}

describe('paused members whose worktree is gone', () => {
  // Why: a lead removed five merged worktrees and the Team panel kept all five 'paused' for hours.
  it('drops them on the next read and keeps the one whose worktree is still there', async () => {
    const goneIds = [85, 87, 88, 90, 94].map((n) => `repo-a::/w/wainbox-${n}`)
    const { store, paused } = setup(new Set(goneIds))
    for (const [index, id] of goneIds.entries()) {
      await paused.record('repo:a', saved(`WAINBOX-${[85, 87, 88, 90, 94][index]}`, id))
    }
    await paused.record('repo:a', saved('WAINBOX-99', 'repo-a::/w/wainbox-99'))

    const view = await paused.note('repo:a', [])

    expect(view.paused.map((one) => one.ticket)).toEqual(['WAINBOX-99'])
    expect(await ticketsOf(store)).toEqual(['WAINBOX-99'])
    expect((await paused.note('repo:a', [])).paused.map((one) => one.ticket)).toEqual([
      'WAINBOX-99'
    ])
  })

  it('keeps a member whose worktree cannot be judged, as on an unreachable host', async () => {
    const { store, paused } = setup(new Set())
    await paused.record('repo:a', saved('ORCA-1', 'repo-a::/w/orca-1'))

    expect((await paused.note('repo:a', [])).paused.map((one) => one.ticket)).toEqual(['ORCA-1'])
    expect(await ticketsOf(store)).toEqual(['ORCA-1'])
  })

  it('frees the members of a removed worktree and nothing else', async () => {
    const { store, paused } = setup(new Set())
    await paused.record('repo:a', saved('ORCA-1', 'repo-a::/w/orca-1'))
    await paused.record('repo:a', saved('ORCA-2', 'repo-a::/w/orca-2'))

    expect(await paused.forgetWorktree('repo:a', 'repo-a::/w/orca-1')).toEqual(['ORCA-1'])
    expect(await ticketsOf(store)).toEqual(['ORCA-2'])
    expect(await paused.forgetWorktree('repo:a', 'repo-a::/w/orca-9')).toEqual([])
  })
})
