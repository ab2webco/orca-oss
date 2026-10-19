import { describe, expect, it } from 'vitest'
import { GameLeads, type GameLeadSession } from './orchestrator-game-leads'
import type { GameBoardProject } from './orchestrator-game-board'

const LEAD: GameBoardProject = {
  key: 'repo:a',
  isMember: false,
  memberTicket: null,
  lead: { handle: 'term_a', paneKey: null }
}

function leads(project: GameBoardProject, live: string[] = ['term_a']) {
  return new GameLeads({
    projectOf: async () => project,
    isLive: (handle) => live.includes(handle),
    now: () => new Date(Date.UTC(2026, 9, 17, 10))
  })
}

describe('GameLeads', () => {
  it('registers the calling lead for its project and lists it while its terminal lives', async () => {
    const game = leads(LEAD)

    await expect(
      game.register({ terminalHandle: 'term_a', project: 'cineco', label: 'Ana' })
    ).resolves.toEqual({ registered: true })

    expect(game.list()).toEqual({
      leads: [
        { project: 'cineco', label: 'Ana', handle: 'term_a', since: '2026-10-17T10:00:00.000Z' }
      ]
    })
  })

  it('never registers a member or a caller without a terminal', async () => {
    const member = leads({ ...LEAD, isMember: true, memberTicket: 'CIN-1' })
    const nobody = leads({ ...LEAD, lead: null })

    await expect(member.register({ project: 'cineco', label: '' })).resolves.toEqual({
      registered: false
    })
    await expect(nobody.register({ project: 'cineco', label: '' })).resolves.toEqual({
      registered: false
    })
    expect(member.list().leads).toEqual([])
    expect(nobody.list().leads).toEqual([])
  })

  it('drops a lead once its terminal is gone', async () => {
    const live = ['term_a']
    const game = leads(LEAD, live)
    await game.register({ project: 'cineco', label: 'Ana' })

    live.length = 0

    expect(game.list().leads).toEqual([])
  })

  it('gives the inbox the labels of the live leads', async () => {
    const game = leads(LEAD)
    await game.register({ project: 'cineco', label: '' })

    expect(game.labels()).toEqual({ term_a: 'cineco' })
  })
})

describe('GameLeads claim', () => {
  const SESSION: GameLeadSession = {
    sessionId: 'sess-old',
    agentArgs: '--teammate-mode auto',
    worktreeId: 'wt1'
  }

  function claiming(args: {
    project?: GameBoardProject
    live: string[]
    stored?: GameLeadSession | null
    caller?: GameLeadSession | null
    resume?: () => Promise<string>
  }) {
    const stored = new Map<string, GameLeadSession>()
    if (args.stored) {
      stored.set('repo:a', args.stored)
    }
    const focused: string[] = []
    const resumed: GameLeadSession[] = []
    const game = new GameLeads({
      projectOf: async () => args.project ?? LEAD,
      isLive: (handle) => args.live.includes(handle),
      sessions: {
        read: async (key) => stored.get(key) ?? null,
        write: async (key, session) => {
          stored.set(key, session)
        }
      },
      sessionOf: async () => args.caller ?? null,
      resume: async (session) => {
        resumed.push(session)
        return (args.resume ?? (async () => 'term_resumed'))()
      },
      focus: async (handle) => {
        focused.push(handle)
      }
    })
    return { game, stored, focused, resumed }
  }

  it('reuses the live lead: focuses it and does not register a second caller', async () => {
    let caller = 'term_a'
    const focused: string[] = []
    const game = new GameLeads({
      projectOf: async () => ({ ...LEAD, lead: { handle: caller, paneKey: null } }),
      isLive: () => true,
      sessions: { read: async () => null, write: async () => undefined },
      sessionOf: async () => null,
      resume: async () => 'never',
      focus: async (handle) => {
        focused.push(handle)
      }
    })
    await game.register({ project: 'cineco', label: 'Ana', claim: true })

    caller = 'term_b'
    await expect(game.register({ project: 'cineco', label: 'Ana', claim: true })).resolves.toEqual({
      registered: false,
      live: { handle: 'term_a' }
    })
    expect(focused).toEqual(['term_a'])
    expect(game.list().leads.map((one) => one.handle)).toEqual(['term_a'])

    caller = 'term_a'
    await expect(game.register({ project: 'cineco', label: 'Ana', claim: true })).resolves.toEqual({
      registered: true
    })
    expect(focused).toEqual(['term_a'])
  })

  it('resumes the stored conversation of a closed lead and lists the resumed pane', async () => {
    const { game, resumed, focused } = claiming({
      live: ['term_a', 'term_resumed'],
      stored: SESSION,
      caller: { ...SESSION, sessionId: 'sess-new' }
    })

    await expect(game.register({ project: 'cineco', label: 'Ana', claim: true })).resolves.toEqual({
      registered: false,
      resumed: { handle: 'term_resumed' }
    })
    expect(resumed).toEqual([SESSION])
    expect(focused).toEqual([])
    expect(game.list().leads.map((one) => one.handle)).toEqual(['term_resumed'])
  })

  it('starts a new lead and says why when the resume fails', async () => {
    const caller = { ...SESSION, sessionId: 'sess-new' }
    const { game, stored } = claiming({
      live: ['term_a'],
      stored: SESSION,
      caller,
      resume: async () => {
        throw new Error('agent_session_legacy_required')
      }
    })

    await expect(game.register({ project: 'cineco', label: 'Ana', claim: true })).resolves.toEqual({
      registered: true,
      resumeError: 'agent_session_legacy_required'
    })
    expect(game.list().leads.map((one) => one.handle)).toEqual(['term_a'])
    expect(stored.get('repo:a')).toEqual(caller)
  })

  it('keeps a resumed lead that runs game lead again as the lead', async () => {
    const { game, resumed } = claiming({ live: ['term_a'], stored: SESSION, caller: SESSION })

    await expect(game.register({ project: 'cineco', label: 'Ana', claim: true })).resolves.toEqual({
      registered: true
    })
    expect(resumed).toEqual([])
  })

  it('stores the session of a new lead for its project', async () => {
    const { game, stored } = claiming({ live: ['term_a'], caller: SESSION })

    await game.register({ project: 'cineco', label: 'Ana', claim: true })

    expect(stored.get('repo:a')).toEqual(SESSION)
  })

  it('neither enforces nor resumes for a caller Orca cannot place in a project', async () => {
    const { game, resumed, stored } = claiming({
      project: { ...LEAD, key: 'no-project' },
      live: ['term_a'],
      caller: SESSION
    })
    stored.set('no-project', { ...SESSION, sessionId: 'sess-other' })

    await expect(game.register({ project: 'x', label: '', claim: true })).resolves.toEqual({
      registered: true
    })
    expect(resumed).toEqual([])
    expect(stored.get('no-project')?.sessionId).toBe('sess-other')
  })

  it('does not count a lead pane that fell back to a shell as the live lead', async () => {
    let caller = 'term_a'
    const focused: string[] = []
    const game = new GameLeads({
      projectOf: async () => ({ ...LEAD, lead: { handle: caller, paneKey: null } }),
      isLive: () => true,
      isRunning: async (handle) => handle !== 'term_a',
      sessions: { read: async () => null, write: async () => undefined },
      sessionOf: async () => null,
      focus: async (handle) => {
        focused.push(handle)
      }
    })
    await game.register({ project: 'cineco', label: 'Ana', claim: true })

    caller = 'term_b'
    await expect(game.leadElsewhere({})).resolves.toBeNull()
    await expect(game.register({ project: 'cineco', label: 'Ana', claim: true })).resolves.toEqual({
      registered: true
    })
    expect(focused).toEqual([])
    expect(game.list().leads.map((one) => one.handle)).toEqual(['term_b'])
  })

  it('resumes once when two panes claim a closed lead at the same time', async () => {
    let caller = 'term_a'
    const resumed: string[] = []
    const game = new GameLeads({
      projectOf: async () => ({ ...LEAD, lead: { handle: caller, paneKey: null } }),
      isLive: () => true,
      sessions: { read: async () => SESSION, write: async () => undefined },
      sessionOf: async () => null,
      resume: async (session) => {
        resumed.push(session.sessionId)
        return 'term_resumed'
      },
      focus: async () => undefined
    })

    const first = game.register({ project: 'cineco', label: 'Ana', claim: true })
    caller = 'term_b'
    const second = game.register({ project: 'cineco', label: 'Ana', claim: true })

    await expect(Promise.all([first, second])).resolves.toEqual([
      { registered: false, resumed: { handle: 'term_resumed' } },
      { registered: false, live: { handle: 'term_resumed' } }
    ])
    expect(resumed).toEqual(['sess-old'])
  })
})

describe('GameLeads leadElsewhere', () => {
  it("names the project's live lead to any other pane, and nothing to the lead itself", async () => {
    let caller = 'term_a'
    const game = new GameLeads({
      projectOf: async () => ({ ...LEAD, lead: { handle: caller, paneKey: null } }),
      isLive: () => true
    })
    await game.register({ project: 'cineco', label: 'Ana', claim: true })

    await expect(game.leadElsewhere({})).resolves.toBeNull()
    caller = 'term_b'
    await expect(game.leadElsewhere({})).resolves.toBe('term_a')
  })

  it('names no lead for a member or a caller Orca cannot place', async () => {
    const member = leads({ ...LEAD, isMember: true })
    const unplaced = leads({
      ...LEAD,
      key: 'no-project',
      lead: { handle: 'term_b', paneKey: null }
    })
    await unplaced.register({ project: 'x', label: '' })

    await expect(member.leadElsewhere({})).resolves.toBeNull()
    await expect(unplaced.leadElsewhere({})).resolves.toBeNull()
  })
})
