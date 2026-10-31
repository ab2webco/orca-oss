import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameLeadRoster } from './orchestrator-game-lead-roster'
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

    expect(await game.list()).toEqual({
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
    expect((await member.list()).leads).toEqual([])
    expect((await nobody.list()).leads).toEqual([])
  })

  it('drops a lead once its terminal is gone', async () => {
    const live = ['term_a']
    const game = leads(LEAD, live)
    await game.register({ project: 'cineco', label: 'Ana' })

    live.length = 0

    expect((await game.list()).leads).toEqual([])
  })

  it('does not list a lead whose pane is back at its shell', async () => {
    const game = new GameLeads({
      projectOf: async () => LEAD,
      isLive: () => true,
      isRunning: async () => false
    })
    await game.register({ project: 'cineco', label: 'Ana' })

    expect((await game.list()).leads).toEqual([])
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
    worktreeId: 'wt1',
    accountId: null
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
        },
        clear: async (key) => {
          stored.delete(key)
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
      sessions: {
        read: async () => null,
        write: async () => undefined,
        clear: async () => undefined
      },
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
    expect((await game.list()).leads.map((one) => one.handle)).toEqual(['term_a'])

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
    expect((await game.list()).leads.map((one) => one.handle)).toEqual(['term_resumed'])
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
    expect((await game.list()).leads.map((one) => one.handle)).toEqual(['term_a'])
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

  it('rotates on fresh: the caller becomes the lead and its conversation replaces the stored one (ORCA-822)', async () => {
    const caller = { ...SESSION, sessionId: 'sess-new' }
    const { game, stored, resumed } = claiming({ live: ['term_a'], stored: SESSION, caller })

    await expect(
      game.register({ project: 'cineco', label: 'Ana', claim: true, fresh: true })
    ).resolves.toEqual({ registered: true })
    expect(resumed).toEqual([])
    expect(stored.get('repo:a')).toEqual(caller)
    expect((await game.list()).leads.map((one) => one.handle)).toEqual(['term_a'])
  })

  it('retires the stored conversation on fresh even when the caller reports none yet (ORCA-822)', async () => {
    const { game, stored, resumed } = claiming({ live: ['term_a'], stored: SESSION, caller: null })

    await expect(
      game.register({ project: 'cineco', label: 'Ana', claim: true, fresh: true })
    ).resolves.toEqual({ registered: true })
    expect(resumed).toEqual([])
    expect(stored.has('repo:a')).toBe(false)
  })

  it('keeps the live lead on fresh: rotation needs the outgoing lead closed first (ORCA-822)', async () => {
    let caller = 'term_a'
    const focused: string[] = []
    const game = new GameLeads({
      projectOf: async () => ({ ...LEAD, lead: { handle: caller, paneKey: null } }),
      isLive: () => true,
      sessions: {
        read: async () => SESSION,
        write: async () => undefined,
        clear: async () => undefined
      },
      sessionOf: async () => null,
      resume: async () => 'never',
      focus: async (handle) => {
        focused.push(handle)
      }
    })
    await game.register({ project: 'cineco', label: 'Ana', claim: true, fresh: true })

    caller = 'term_b'
    await expect(
      game.register({ project: 'cineco', label: 'Ana', claim: true, fresh: true })
    ).resolves.toEqual({ registered: false, live: { handle: 'term_a' } })
    expect(focused).toEqual(['term_a'])
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
      sessions: {
        read: async () => null,
        write: async () => undefined,
        clear: async () => undefined
      },
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
    expect((await game.list()).leads.map((one) => one.handle)).toEqual(['term_b'])
  })

  it('resumes once when two panes claim a closed lead at the same time', async () => {
    let caller = 'term_a'
    const resumed: string[] = []
    const game = new GameLeads({
      projectOf: async () => ({ ...LEAD, lead: { handle: caller, paneKey: null } }),
      isLive: () => true,
      sessions: {
        read: async () => SESSION,
        write: async () => undefined,
        clear: async () => undefined
      },
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

describe('GameLeads after a restart', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  const PANE = 'tab-1:leaf-1'
  const AT = '2026-10-17T10:00:00.000Z'

  function rosterDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'orca-game-leads-'))
    dirs.push(dir)
    return dir
  }

  // The first launch: `term_a` in pane PANE runs `game lead` with conversation sess-1.
  async function registeredBefore(dir: string, project: GameBoardProject = LEAD): Promise<void> {
    const before = new GameLeads({
      projectOf: async () => project,
      isLive: () => true,
      now: () => new Date(AT),
      roster: new GameLeadRoster(() => dir),
      sessionOf: async () => ({
        sessionId: 'sess-1',
        agentArgs: null,
        worktreeId: 'wt1',
        accountId: null
      })
    })
    await before.register({ project: 'cineco', label: 'Ana', claim: true })
  }

  // The relaunch: handles are minted anew, so the surviving pane answers to `term_new`.
  function relaunched(
    dir: string,
    pane: {
      handle?: () => string | null
      state?: () => 'running' | 'shell' | 'starting'
      sessionId?: string | null
      caller?: string
    } = {}
  ) {
    const caller = pane.caller ?? 'term_new'
    return new GameLeads({
      projectOf: async () => ({ ...LEAD, lead: { handle: caller, paneKey: null } }),
      isLive: (handle) => ['term_new', 'term_other'].includes(handle),
      roster: new GameLeadRoster(() => dir),
      handleOfPane: (paneKey) => (paneKey === PANE ? (pane.handle?.() ?? 'term_new') : null),
      paneState: async () => pane.state?.() ?? 'running',
      sessionOf: async () =>
        pane.sessionId === null
          ? null
          : {
              sessionId: pane.sessionId ?? 'sess-1',
              agentArgs: null,
              worktreeId: 'wt1',
              accountId: null
            },
      focus: async () => undefined
    })
  }

  const WITH_PANE: GameBoardProject = { ...LEAD, lead: { handle: 'term_a', paneKey: PANE } }

  it('lists a lead whose pane survived the restart, under the handle the pane has now', async () => {
    const dir = rosterDir()
    await registeredBefore(dir, WITH_PANE)

    await expect(relaunched(dir).list()).resolves.toEqual({
      leads: [{ project: 'cineco', label: 'Ana', handle: 'term_new', since: AT }]
    })
  })

  it('lists it when the conversation is not reported yet but Claude runs in the pane', async () => {
    const dir = rosterDir()
    await registeredBefore(dir, WITH_PANE)

    const leads = (await relaunched(dir, { sessionId: null }).list()).leads
    expect(leads.map((one) => one.handle)).toEqual(['term_new'])
  })

  it('forgets a lead whose pane is back at its shell', async () => {
    const dir = rosterDir()
    await registeredBefore(dir, WITH_PANE)

    await expect(relaunched(dir, { state: () => 'shell' }).list()).resolves.toEqual({ leads: [] })
    await expect(new GameLeadRoster(() => dir).read()).resolves.toEqual([])
  })

  it('forgets a lead whose pane now holds another conversation', async () => {
    const dir = rosterDir()
    await registeredBefore(dir, WITH_PANE)

    await expect(relaunched(dir, { sessionId: 'sess-2' }).list()).resolves.toEqual({ leads: [] })
    await expect(new GameLeadRoster(() => dir).read()).resolves.toEqual([])
  })

  it('lists it on its conversation alone, whatever the pane shows in front', async () => {
    const dir = rosterDir()
    await registeredBefore(dir, WITH_PANE)

    const leads = (await relaunched(dir, { state: () => 'starting' }).list()).leads
    expect(leads.map((one) => one.handle)).toEqual(['term_new'])
  })

  it('waits for a pane that is not back yet, or not yet running Claude, and lists it once it is', async () => {
    const dir = rosterDir()
    await registeredBefore(dir, WITH_PANE)
    let handle: string | null = null
    let state: 'running' | 'starting' = 'starting'
    const game = relaunched(dir, { handle: () => handle, state: () => state, sessionId: null })

    await expect(game.list()).resolves.toEqual({ leads: [] })
    handle = 'term_new'
    await expect(game.list()).resolves.toEqual({ leads: [] })
    state = 'running'
    expect((await game.list()).leads.map((one) => one.handle)).toEqual(['term_new'])
  })

  it('lists no pane that never ran game lead', async () => {
    const dir = rosterDir()

    await expect(relaunched(dir).list()).resolves.toEqual({ leads: [] })
  })

  it('keeps the surviving lead when another pane claims the project before anyone lists', async () => {
    const dir = rosterDir()
    await registeredBefore(dir, WITH_PANE)

    await expect(
      relaunched(dir, { caller: 'term_other' }).register({
        project: 'cineco',
        label: 'Bo',
        claim: true
      })
    ).resolves.toEqual({ registered: false, live: { handle: 'term_new' } })
  })

  it('names the surviving lead to another pane', async () => {
    const dir = rosterDir()
    await registeredBefore(dir, WITH_PANE)

    await expect(relaunched(dir, { caller: 'term_other' }).leadElsewhere({})).resolves.toBe(
      'term_new'
    )
  })

  it('keeps nothing for a caller without a pane or one Orca cannot place', async () => {
    const dir = rosterDir()
    await registeredBefore(dir, LEAD)
    await registeredBefore(dir, { ...WITH_PANE, key: 'no-project' })

    await expect(new GameLeadRoster(() => dir).read()).resolves.toEqual([])
  })
})

describe('GameLeads.liveLeadOf (ORCA-878)', () => {
  it("names a project's live lead for a caller that is no terminal, and none once it is gone", async () => {
    const live = ['term_a']
    const game = leads(LEAD, live)
    await game.register({ terminalHandle: 'term_a', project: 'cineco', label: 'Ana' })

    await expect(game.liveLeadOf('repo:a')).resolves.toBe('term_a')
    await expect(game.liveLeadOf('repo:other')).resolves.toBeNull()
    live.length = 0
    await expect(game.liveLeadOf('repo:a')).resolves.toBeNull()
  })
})

describe('GameLeads while a restart restores the lead (ORCA-728)', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  const LEAD_PANE = 'tab-1:leaf-1'
  const AT = Date.UTC(2026, 9, 17, 10)
  const STORED: GameLeadSession = {
    sessionId: 'sess-lead',
    agentArgs: null,
    worktreeId: 'wt1',
    accountId: null
  }
  // Two former lead sessions whose tabs the restore also brought back.
  const FORMER: Record<string, { paneKey: string; sessionId: string }> = {
    term_b: { paneKey: 'tab-2:leaf-1', sessionId: 'sess-b' },
    term_c: { paneKey: 'tab-3:leaf-1', sessionId: 'sess-c' }
  }

  async function recordedLead(): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'orca-game-leads-'))
    dirs.push(dir)
    await new GameLeads({
      projectOf: async () => ({ ...LEAD, lead: { handle: 'term_a', paneKey: LEAD_PANE } }),
      isLive: () => true,
      now: () => new Date(AT),
      roster: new GameLeadRoster(() => dir),
      sessionOf: async () => STORED
    }).register({ project: 'cineco', label: 'Ana', claim: true })
    return dir
  }

  // The relaunch: the lead's pane reconnects and starts Claude only after the former leads resume.
  function restoring(dir: string, args: { now?: () => number; onWait?: (waits: number) => void }) {
    const lead = {
      handle: null as string | null,
      state: 'starting' as 'running' | 'shell' | 'starting'
    }
    const resumed: string[] = []
    let waits = 0
    const sessionOfHandle = (handle: string): GameLeadSession | null => {
      if (handle === 'term_new') {
        return lead.state === 'running' ? STORED : null
      }
      const former = FORMER[handle]
      return former ? { ...STORED, sessionId: former.sessionId } : null
    }
    const game = new GameLeads({
      projectOf: async (caller) => ({
        ...LEAD,
        lead: {
          handle: caller.terminalHandle ?? '',
          paneKey: FORMER[caller.terminalHandle ?? '']?.paneKey ?? null
        }
      }),
      isLive: (handle) => handle === lead.handle || handle in FORMER,
      now: () => new Date(args.now?.() ?? AT),
      wait: async () => {
        waits += 1
        args.onWait?.(waits)
      },
      roster: new GameLeadRoster(() => dir),
      sessions: {
        read: async () => STORED,
        write: async () => undefined,
        clear: async () => undefined
      },
      sessionOf: async (handle) => sessionOfHandle(handle),
      resume: async (session) => {
        resumed.push(session.sessionId)
        return 'term_resumed'
      },
      focus: async () => undefined,
      handleOfPane: (paneKey) => (paneKey === LEAD_PANE ? lead.handle : null),
      paneState: async (handle) => (handle === 'term_new' ? lead.state : 'running')
    })
    return { game, lead, resumed }
  }

  const claimOf = (game: GameLeads, terminalHandle: string) =>
    game.register({ terminalHandle, project: 'cineco', label: 'Ana', claim: true })

  it('keeps exactly one acting lead when two former lead sessions claim before the lead is back', async () => {
    const dir = await recordedLead()
    const world = restoring(dir, {
      onWait: (waits) => {
        if (waits === 1) {
          world.lead.handle = 'term_new'
        } else if (waits === 2) {
          world.lead.state = 'running'
        }
      }
    })

    await expect(
      Promise.all([claimOf(world.game, 'term_b'), claimOf(world.game, 'term_c')])
    ).resolves.toEqual([
      { registered: false, live: { handle: 'term_new' } },
      { registered: false, live: { handle: 'term_new' } }
    ])
    expect(world.resumed).toEqual([])
    expect((await world.game.list()).leads.map((one) => one.handle)).toEqual(['term_new'])
  })

  it('names the restoring lead to a former lead as soon as its pane is back', async () => {
    const dir = await recordedLead()
    const world = restoring(dir, {})

    await expect(world.game.leadElsewhere({ terminalHandle: 'term_b' })).resolves.toBeNull()
    world.lead.handle = 'term_new'
    await expect(world.game.leadElsewhere({ terminalHandle: 'term_b' })).resolves.toBe('term_new')
  })

  it('lets a former lead claim once the restoring pane turns out to be a shell', async () => {
    const dir = await recordedLead()
    const world = restoring(dir, {
      onWait: () => {
        world.lead.handle = 'term_new'
        world.lead.state = 'shell'
      }
    })

    await expect(claimOf(world.game, 'term_b')).resolves.toEqual({
      registered: false,
      resumed: { handle: 'term_resumed' }
    })
    expect(world.resumed).toEqual(['sess-lead'])
  })

  it('stops waiting for a lead whose pane never comes back once the restore grace is over', async () => {
    const dir = await recordedLead()
    let now = AT
    const world = restoring(dir, { now: () => now })
    await world.game.list()
    now = AT + 10 * 60_000

    await expect(world.game.leadElsewhere({ terminalHandle: 'term_b' })).resolves.toBeNull()
    await expect(claimOf(world.game, 'term_b')).resolves.toEqual({
      registered: false,
      resumed: { handle: 'term_resumed' }
    })
  })

  it('gives up a bounded wait and claims as today when the lead pane stays away', async () => {
    const dir = await recordedLead()
    const world = restoring(dir, {})

    await expect(claimOf(world.game, 'term_b')).resolves.toEqual({
      registered: false,
      resumed: { handle: 'term_resumed' }
    })
  })
})
