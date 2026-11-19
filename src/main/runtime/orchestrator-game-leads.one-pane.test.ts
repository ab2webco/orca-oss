import { describe, expect, it } from 'vitest'
import { GameLeads, type GameLeadSession } from './orchestrator-game-leads'
import type { GameBoardProject } from './orchestrator-game-board'

const SESSION: GameLeadSession = {
  sessionId: 'sess-lead',
  agentArgs: null,
  worktreeId: 'wt-lead',
  accountId: null
}

const MENU: GameBoardProject = { key: 'repo:a', isMember: false, memberTicket: null, lead: null }
const CALLER: GameBoardProject = { ...MENU, lead: { handle: 'term_new', paneKey: 'tab-new:1' } }

// Why the pane on the conversation is outside the directory: after a restart Orca had not matched it.
function leadsWith(args: { project: GameBoardProject; onConversation: string[] }) {
  const live = new Set(['term_new', ...args.onConversation])
  const resumed: GameLeadSession[] = []
  const focused: string[] = []
  const game = new GameLeads({
    projectOf: async () => args.project,
    isLive: (handle) => live.has(handle),
    sessions: {
      read: async () => SESSION,
      write: async () => undefined,
      clear: async () => undefined
    },
    sessionOf: async (handle) =>
      handle === 'term_new' ? { ...SESSION, sessionId: 'sess-new' } : SESSION,
    panesOfConversation: async (session) =>
      session.sessionId === SESSION.sessionId ? args.onConversation : [],
    resume: async (session) => {
      resumed.push(session)
      live.add('term_resumed')
      return 'term_resumed'
    },
    focus: async (handle) => {
      focused.push(handle)
    }
  })
  return { game, resumed, focused }
}

// Why (ORCA-1283): a reopen beside a live pane on the same conversation ran two leads on one Claude conversation.
describe('a lead conversation already live in a pane', () => {
  it("is focused, not resumed again, when the + menu's Reopen team runs", async () => {
    const { game, resumed, focused } = leadsWith({ project: MENU, onConversation: ['term_old'] })

    await expect(
      game.reopen({ worktreeId: 'wt-2', project: 'orca-oss', label: '' })
    ).resolves.toEqual({ registered: false, live: { handle: 'term_old' } })
    expect(resumed).toEqual([])
    expect(focused).toEqual(['term_old'])
    expect((await game.list()).leads.map((one) => one.handle)).toEqual(['term_old'])
  })

  it('is focused, not resumed again, when a new pane claims the lead', async () => {
    const { game, resumed, focused } = leadsWith({ project: CALLER, onConversation: ['term_old'] })

    await expect(
      game.register({ terminalHandle: 'term_new', project: 'orca-oss', label: '', claim: true })
    ).resolves.toEqual({ registered: false, live: { handle: 'term_old' } })
    expect(resumed).toEqual([])
    expect(focused).toEqual(['term_old'])
  })

  it('still reopens when no pane holds the conversation', async () => {
    const { game, resumed } = leadsWith({ project: MENU, onConversation: [] })

    await expect(
      game.reopen({ worktreeId: 'wt-2', project: 'orca-oss', label: '' })
    ).resolves.toEqual({ registered: false, resumed: { handle: 'term_resumed' } })
    expect(resumed).toEqual([SESSION])
  })
})

describe('GameLeads.duplicateOf', () => {
  it('names every pane when two hold the lead conversation', async () => {
    const { game } = leadsWith({ project: CALLER, onConversation: ['term_old', 'term_copy'] })

    await expect(game.duplicateOf({ terminalHandle: 'term_new' })).resolves.toEqual({
      terminals: ['term_copy', 'term_old']
    })
  })

  it('is null with one pane on the conversation', async () => {
    const { game } = leadsWith({ project: CALLER, onConversation: ['term_old'] })

    await expect(game.duplicateOf({ terminalHandle: 'term_new' })).resolves.toBeNull()
  })

  it("is null for a member, which does not hold its lead's conversation", async () => {
    const { game } = leadsWith({
      project: { ...CALLER, isMember: true },
      onConversation: ['term_old', 'term_copy']
    })

    await expect(game.duplicateOf({ terminalHandle: 'term_new' })).resolves.toBeNull()
  })
})
