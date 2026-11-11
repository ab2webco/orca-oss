import { describe, expect, it } from 'vitest'
import { GameLeads, type GameLeadSession } from './orchestrator-game-leads'
import type { GameBoardProject } from './orchestrator-game-board'

const LEAD: GameBoardProject = {
  key: 'repo:a',
  isMember: false,
  memberTicket: null,
  lead: { handle: 'term_a', paneKey: null }
}

const SESSION: GameLeadSession = {
  sessionId: 's-1',
  agentArgs: null,
  worktreeId: 'wt-1',
  accountId: 'acct-glm'
}

function leadsWith(project: GameBoardProject, stored: Map<string, GameLeadSession>) {
  return new GameLeads({
    projectOf: async () => project,
    isLive: () => false,
    sessions: {
      read: async (key) => stored.get(key) ?? null,
      write: async () => undefined,
      clear: async () => undefined
    }
  })
}

// Why (ORCA-717): the + menu offers Reopen team only when the project's lead conversation is kept.
describe('GameLeads.storedLeadOf', () => {
  it("names the account of the project's stored lead conversation", async () => {
    const game = leadsWith(LEAD, new Map([['repo:a', SESSION]]))

    await expect(game.storedLeadOf({ worktreeId: 'wt-2' })).resolves.toEqual({
      accountId: 'acct-glm'
    })
  })

  it('has none when the project keeps no lead conversation', async () => {
    const game = leadsWith(LEAD, new Map())

    await expect(game.storedLeadOf({ worktreeId: 'wt-2' })).resolves.toBeNull()
  })

  it('has none for a worktree Orca cannot place in a project', async () => {
    const game = leadsWith({ ...LEAD, key: 'no-project' }, new Map([['no-project', SESSION]]))

    await expect(game.storedLeadOf({ worktreeId: 'wt-2' })).resolves.toBeNull()
  })

  it('has none when the stored conversation cannot be read', async () => {
    const game = new GameLeads({
      projectOf: async () => LEAD,
      isLive: () => false,
      sessions: {
        read: async () => {
          throw new Error('EACCES')
        },
        write: async () => undefined,
        clear: async () => undefined
      }
    })

    await expect(game.storedLeadOf({ worktreeId: 'wt-2' })).resolves.toBeNull()
  })
})
