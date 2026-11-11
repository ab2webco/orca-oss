import { describe, expect, it } from 'vitest'
import { GameLeads, type GameLeadSession } from './orchestrator-game-leads'
import type { GameBoardProject } from './orchestrator-game-board'

// Why no lead: the + menu calls with a worktree only, no pane of its own.
const PROJECT: GameBoardProject = { key: 'repo:a', isMember: false, memberTicket: null, lead: null }

const SESSION: GameLeadSession = {
  sessionId: 'sess-1',
  agentArgs: null,
  worktreeId: 'wt-lead',
  accountId: 'acct-glm'
}

function reopening(args: {
  project?: GameBoardProject
  live?: string[]
  stored?: GameLeadSession | null
  resume?: () => Promise<string>
}) {
  const live = new Set(args.live ?? [])
  const resumed: GameLeadSession[] = []
  const focused: string[] = []
  const game = new GameLeads({
    projectOf: async () => args.project ?? PROJECT,
    isLive: (handle) => live.has(handle),
    sessions: {
      read: async () => args.stored ?? null,
      write: async () => undefined,
      clear: async () => undefined
    },
    resume: async (session) => {
      resumed.push(session)
      const handle = await (args.resume ?? (async () => 'term_resumed'))()
      live.add(handle)
      return handle
    },
    focus: async (handle) => {
      focused.push(handle)
    }
  })
  return { game, resumed, focused }
}

const CALL = { worktreeId: 'wt-2', project: 'orca-oss', label: '' }

// Why (ORCA-717): the + menu's Reopen team reopens the kept lead with no pane of its own to leave over.
describe('GameLeads.reopen', () => {
  it("reopens the kept conversation in its own pane and lists that pane as the project's lead", async () => {
    const { game, resumed } = reopening({ stored: SESSION })

    await expect(game.reopen(CALL)).resolves.toEqual({
      registered: false,
      resumed: { handle: 'term_resumed' }
    })
    expect(resumed).toEqual([SESSION])
    expect((await game.list()).leads.map((one) => one.handle)).toEqual(['term_resumed'])
  })

  it('focuses a live lead and reopens nothing', async () => {
    const { game, resumed, focused } = reopening({ stored: SESSION })
    await game.reopen(CALL)

    await expect(game.reopen(CALL)).resolves.toEqual({
      registered: false,
      live: { handle: 'term_resumed' }
    })
    expect(resumed).toHaveLength(1)
    expect(focused).toEqual(['term_resumed'])
  })

  it('reopens nothing when the project keeps no lead conversation', async () => {
    const { game, resumed } = reopening({ stored: null })

    await expect(game.reopen(CALL)).resolves.toEqual({ registered: false })
    expect(resumed).toEqual([])
  })

  it('says why when the conversation does not reopen, and lists no lead', async () => {
    const { game } = reopening({
      stored: SESSION,
      resume: async () => {
        throw new Error('No conversation found')
      }
    })

    await expect(game.reopen(CALL)).resolves.toEqual({
      registered: false,
      resumeError: 'No conversation found'
    })
    expect((await game.list()).leads).toEqual([])
  })

  it("never reopens from a member's worktree or one Orca cannot place", async () => {
    for (const project of [
      { ...PROJECT, isMember: true },
      { ...PROJECT, key: 'no-project' }
    ]) {
      const { game, resumed } = reopening({ project, stored: SESSION })

      await expect(game.reopen(CALL)).resolves.toEqual({ registered: false })
      expect(resumed).toEqual([])
    }
  })
})
