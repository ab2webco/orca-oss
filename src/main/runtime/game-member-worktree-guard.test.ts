import { describe, expect, it, vi } from 'vitest'
import type { GameMemberSession } from '../../shared/orchestrator-game-member-sessions'
import {
  memberWorktreeRefusal,
  memberWorktreeWarning,
  parseUnpushedCommits,
  readGameMemberWorktreeHold
} from './game-member-worktree-guard'

const member = (ticket: string, extra: Partial<GameMemberSession> = {}): GameMemberSession => ({
  ticket,
  name: `Merlin · ${ticket}`,
  runId: 'run_1',
  taskId: `task_${ticket}`,
  dispatchId: null,
  worktreeId: `wt-${ticket}`,
  branch: ticket.toLowerCase(),
  agent: 'claude',
  accountId: null,
  account: null,
  sessionId: null,
  lastState: 'working',
  launchedAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  ...extra
})

describe('readGameMemberWorktreeHold (ORCA-746)', () => {
  it('names the saved member holding the worktree, with its unpushed commits', async () => {
    const listUnpushed = vi.fn(async () => ['abc1234 feat: queue setups', 'def5678 test: guard'])
    const hold = await readGameMemberWorktreeHold({
      read: async () => ({ ok: true, members: [member('ORCA-1'), member('ORCA-2')] }),
      worktreeId: 'wt-ORCA-2',
      listUnpushed
    })

    expect(hold).toEqual({
      ticket: 'ORCA-2',
      name: 'Merlin · ORCA-2',
      lastState: 'working',
      unpushed: ['abc1234 feat: queue setups', 'def5678 test: guard']
    })
  })

  it('lets a finished member, another worktree or an unreadable record through', async () => {
    const listUnpushed = vi.fn(async () => [])
    const finished = await readGameMemberWorktreeHold({
      read: async () => ({ ok: true, members: [member('ORCA-1', { lastState: 'finished' })] }),
      worktreeId: 'wt-ORCA-1',
      listUnpushed
    })
    const other = await readGameMemberWorktreeHold({
      read: async () => ({ ok: true, members: [member('ORCA-1')] }),
      worktreeId: 'wt-elsewhere',
      listUnpushed
    })
    const unreadable = await readGameMemberWorktreeHold({
      read: async () => ({ ok: false, reason: 'damaged' }),
      worktreeId: 'wt-ORCA-1',
      listUnpushed
    })

    expect([finished, other, unreadable]).toEqual([null, null, null])
    expect(listUnpushed).not.toHaveBeenCalled()
  })

  it('still guards the worktree when its commits cannot be read', async () => {
    const hold = await readGameMemberWorktreeHold({
      read: async () => ({ ok: true, members: [member('ORCA-1')] }),
      worktreeId: 'wt-ORCA-1',
      listUnpushed: async () => {
        throw new Error('git missing')
      }
    })

    expect(hold).toMatchObject({ ticket: 'ORCA-1', unpushed: null })
  })
})

describe('member worktree messages', () => {
  const hold = {
    ticket: 'ORCA-2',
    name: 'Merlin · ORCA-2',
    lastState: 'working',
    unpushed: ['abc1234 feat: queue setups']
  }

  it('refuses with what is lost and how to free it', () => {
    const refusal = memberWorktreeRefusal(hold)

    expect(refusal.code).toBe('game_member_worktree')
    expect(refusal.message).toBe(
      'This is the worktree of game member ORCA-2 (Merlin · ORCA-2, last working); removing it loses its work. ' +
        'Unpushed commits (1): abc1234 feat: queue setups. ' +
        '`orca game resume-members ORCA-2` resumes it, `orca game resume-members ORCA-2 --discard` frees it, ' +
        'or pass --force-member to remove it anyway.'
    )
  })

  it('warns after a forced removal, saying when the commits could not be read', () => {
    expect(memberWorktreeWarning({ ...hold, unpushed: null })).toBe(
      'Removed the worktree of game member ORCA-2 (Merlin · ORCA-2, last working). Unpushed commits: unknown (git could not read them).'
    )
    expect(memberWorktreeWarning({ ...hold, unpushed: [] })).toBe(
      'Removed the worktree of game member ORCA-2 (Merlin · ORCA-2, last working). Unpushed commits: none.'
    )
  })
})

describe('parseUnpushedCommits', () => {
  it('reads one commit per line and drops blanks', () => {
    expect(parseUnpushedCommits('abc1234 one\n\ndef5678 two\n')).toEqual([
      'abc1234 one',
      'def5678 two'
    ])
  })
})
