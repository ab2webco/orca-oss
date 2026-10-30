import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_HANDLERS } from './orchestrator-game'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

describe('orca game state', () => {
  const saved = { ...process.env }
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
    process.env.ORCA_PANE_KEY = 'tab:leaf'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
  })

  it('asks the host for the state of the calling terminal and prints it as JSON', async () => {
    const calls: [string, unknown][] = []
    const client = {
      call: async (method: string, params: unknown) => {
        calls.push([method, params])
        return { ok: true, result: { config: { mode: 'zen' }, agents: [] } }
      }
    } as unknown as RuntimeClient

    await ORCHESTRATOR_GAME_HANDLERS['game state']({
      flags: new Map(),
      client,
      cwd: '/tmp',
      json: true
    })

    expect(calls).toEqual([
      ['game.state', { worktreeId: 'wt1', terminalHandle: 'h1', paneKey: 'tab:leaf' }]
    ])
    expect(output.join('')).toContain('"mode": "zen"')
  })

  it("prints each member's ticket, host, account, branch, PR and CI in the JSON (ORCA-863)", async () => {
    const remoteMember = {
      paneKey: 'remote:ctx_1',
      displayName: 'RECOVERY BRIEF. Orca restarted while you were working.',
      agentType: 'claude',
      state: 'working',
      toolName: null,
      isLeader: false,
      isMember: true,
      remote: { host: 'imac', stateKnown: true },
      worktree: { id: 'wt-b', branch: 'fab/cin-1231-retry', displayName: 'RECOVERY BRIEF.' },
      review: {
        provider: 'github',
        number: 42,
        title: 't',
        url: 'u',
        state: 'open',
        ci: 'failure'
      },
      account: { provider: 'claude', id: 'remote:env:two@cineco.co', email: 'two@cineco.co' }
    }
    const client = {
      call: async () => ({
        ok: true,
        result: { config: { mode: 'on' }, worktree: null, review: null, agents: [remoteMember] }
      })
    } as unknown as RuntimeClient

    await ORCHESTRATOR_GAME_HANDLERS['game state']({
      flags: new Map(),
      client,
      cwd: '/tmp',
      json: true
    })

    const printed = JSON.parse(output.join('')) as { result: { agents: unknown[] } }
    expect(printed.result.agents).toEqual([
      {
        ...remoteMember,
        ticket: 'CIN-1231',
        host: 'imac',
        accountEmail: 'two@cineco.co',
        worktreeId: 'wt-b',
        branch: 'fab/cin-1231-retry',
        pr: 42,
        ci: 'failure'
      }
    ])
  })

  it("hands on the member pane's Jev report from the env, dropping one that is not JSON", async () => {
    const calls: unknown[] = []
    const client = {
      call: async (_method: string, params: unknown) => {
        calls.push(params)
        return { ok: true, result: { config: { mode: 'on' }, agents: [] } }
      }
    } as unknown as RuntimeClient
    const run = () =>
      ORCHESTRATOR_GAME_HANDLERS['game state']({
        flags: new Map(),
        client,
        cwd: '/tmp',
        json: true
      })
    const caller = { worktreeId: 'wt1', terminalHandle: 'h1', paneKey: 'tab:leaf' }

    process.env.ORCA_GAME_ADVISOR = '{"version":1,"model":"Sonnet 5.5","effort":null}'
    await run()
    process.env.ORCA_GAME_ADVISOR = 'null'
    await run()
    process.env.ORCA_GAME_ADVISOR = '{not json'
    await run()

    expect(calls).toEqual([
      { ...caller, advisor: { version: 1, model: 'Sonnet 5.5', effort: null } },
      { ...caller, advisor: null },
      caller
    ])
    expect(Object.keys(calls[2] as object)).not.toContain('advisor')
  })

  it('says in text when the project is on STOP and how many messages the lead has unread', async () => {
    const client = {
      call: async () => ({
        ok: true,
        result: {
          config: { mode: 'on', scene: 'quest' },
          sources: { mode: 'default' },
          agents: [],
          warnings: [],
          stopped: { since: '2026-10-16T10:00:00.000Z', by: 'lead' },
          inboxes: [
            { key: 'lead', unread: 2, last: null },
            { key: 'CIN-1', unread: 1, last: null },
            { key: 'CIN-2', unread: 0, last: null }
          ]
        }
      })
    } as unknown as RuntimeClient

    await ORCHESTRATOR_GAME_HANDLERS['game state']({
      flags: new Map(),
      client,
      cwd: '/tmp',
      json: false
    })

    const text = output.join('\n')
    expect(text).toContain(
      'STOP since 2026-10-16T10:00:00.000Z (by lead): `orca game resume` lifts it'
    )
    expect(text).toContain('Inbox: 2 unread; CIN-1 1')
  })

  it('prints the lead brief built from the project lead settings', async () => {
    const client = {
      call: async () => ({
        ok: true,
        result: {
          config: { mode: 'on' },
          agents: [],
          worktree: {
            id: 'wt1',
            path: '/Users/me/cineco-orchestrator',
            branch: 'main',
            displayName: 'main'
          },
          lead: { autostart: true, cap: 3, agent: 'claude', rules: 'Use Jira CIN.' },
          role: 'lead'
        }
      })
    } as unknown as RuntimeClient

    await ORCHESTRATOR_GAME_HANDLERS['game lead']({
      flags: new Map(),
      client,
      cwd: '/tmp',
      json: false
    })

    const text = output.join('\n')
    expect(text).toContain('You are the lead of cineco-orchestrator')
    expect(text).toContain('At most 3 members run at once')
    expect(text).toContain('Use Jira CIN.')
  })

  it('registers the lead with the host under its project name and label', async () => {
    const calls: [string, unknown][] = []
    const client = {
      call: async (method: string, params: unknown) => {
        calls.push([method, params])
        return {
          ok: true,
          result: {
            config: { mode: 'on' },
            agents: [],
            worktree: { id: 'wt1', path: '/Users/me/cineco', branch: 'main', displayName: 'main' },
            lead: { autostart: true, cap: 3, agent: 'claude', label: 'Ana' },
            role: 'lead'
          }
        }
      }
    } as unknown as RuntimeClient

    await ORCHESTRATOR_GAME_HANDLERS['game lead']({
      flags: new Map(),
      client,
      cwd: '/tmp',
      json: true
    })

    expect(calls.map(([method]) => method)).toEqual(['game.state', 'game.leadRegister'])
    expect(calls[1]?.[1]).toEqual({
      worktreeId: 'wt1',
      terminalHandle: 'h1',
      project: 'cineco',
      label: 'Ana',
      claim: true
    })
  })

  it('does not register a member, and prints the brief when the host cannot register', async () => {
    const calls: string[] = []
    const member = {
      call: async (method: string) => {
        calls.push(method)
        return { ok: true, result: { config: { mode: 'on' }, agents: [], role: 'member' } }
      }
    } as unknown as RuntimeClient
    const oldHost = {
      call: async (method: string) => {
        if (method === 'game.leadRegister') {
          throw new RuntimeClientError('method_not_found', 'Unknown method: game.leadRegister')
        }
        return { ok: true, result: { config: { mode: 'on' }, agents: [], role: 'lead' } }
      }
    } as unknown as RuntimeClient

    await ORCHESTRATOR_GAME_HANDLERS['game lead']({
      flags: new Map(),
      client: member,
      cwd: '/tmp',
      json: true
    })
    await ORCHESTRATOR_GAME_HANDLERS['game lead']({
      flags: new Map(),
      client: oldHost,
      cwd: '/tmp',
      json: false
    })

    expect(calls).toEqual(['game.state'])
    expect(output.join('\n')).toContain('You are the lead of')
  })

  const leadHost = (registration: unknown) =>
    ({
      call: async (method: string) =>
        method === 'game.leadRegister'
          ? { ok: true, result: registration }
          : {
              ok: true,
              result: {
                config: { mode: 'on' },
                agents: [],
                worktree: {
                  id: 'wt1',
                  path: '/Users/me/cineco',
                  branch: 'main',
                  displayName: 'main'
                },
                lead: { autostart: true, cap: 3, agent: 'claude' },
                role: 'lead'
              }
            }
    }) as unknown as RuntimeClient

  it('withholds the lead rules when the project lead is live in another pane', async () => {
    await ORCHESTRATOR_GAME_HANDLERS['game lead']({
      flags: new Map(),
      client: leadHost({ registered: false, live: { handle: 'term_a' } }),
      cwd: '/tmp',
      json: false
    })

    const text = output.join('\n')
    expect(text).toMatch(/^Not the lead: cineco's lead is live in another pane \(term_a\)/)
    expect(text).not.toContain('You are the lead of')
  })

  it('withholds the lead rules when Orca reopened the closed lead conversation', async () => {
    await ORCHESTRATOR_GAME_HANDLERS['game lead']({
      flags: new Map(),
      client: leadHost({ registered: false, resumed: { handle: 'term_r' } }),
      cwd: '/tmp',
      json: true
    })

    expect(JSON.parse(output.join(''))).toMatchObject({
      result: { role: 'lead', brief: null, outcome: 'resumed', handle: 'term_r' }
    })
  })

  it('says plainly that a failed resume started a new lead, then prints the rules', async () => {
    await ORCHESTRATOR_GAME_HANDLERS['game lead']({
      flags: new Map(),
      client: leadHost({ registered: true, resumeError: 'agent_session_legacy_required' }),
      cwd: '/tmp',
      json: false
    })

    const text = output.join('\n')
    expect(text).toMatch(
      /^Orca could not reopen cineco's previous lead conversation \(agent_session_legacy_required\), so this session is a new lead\./
    )
    expect(text).toContain('You are the lead of cineco')
  })

  it('asks the host for a fresh lead with --fresh and prints the rules (ORCA-822)', async () => {
    const calls: [string, unknown][] = []
    const host = leadHost({ registered: true })
    const client = {
      call: async (method: string, params: unknown) => {
        calls.push([method, params])
        return host.call(method, params)
      }
    } as unknown as RuntimeClient

    await ORCHESTRATOR_GAME_HANDLERS['game lead']({
      flags: new Map([['fresh', true]]),
      client,
      cwd: '/tmp',
      json: false
    })

    expect(calls[1]?.[1]).toMatchObject({ claim: true, fresh: true })
    expect(output.join('\n')).toMatch(/^Orca retired cineco's previous lead conversation/)
    expect(output.join('\n')).toContain('You are the lead of cineco')
  })

  it('says to close the live lead first when --fresh finds one (ORCA-822)', async () => {
    await ORCHESTRATOR_GAME_HANDLERS['game lead']({
      flags: new Map([['fresh', true]]),
      client: leadHost({ registered: false, live: { handle: 'term_a' } }),
      cwd: '/tmp',
      json: false
    })

    const text = output.join('\n')
    expect(text).toMatch(/^Not the lead: cineco's lead is live in another pane \(term_a\)/)
    expect(text).toContain('close that lead, then run `orca game lead --fresh` again')
  })

  it('says an older host reopened the old lead instead of rotating on --fresh (ORCA-822)', async () => {
    await ORCHESTRATOR_GAME_HANDLERS['game lead']({
      flags: new Map([['fresh', true]]),
      client: leadHost({ registered: false, resumed: { handle: 'term_r' } }),
      cwd: '/tmp',
      json: false
    })

    expect(output.join('\n')).toContain('this Orca host does not support --fresh')
  })

  it('tells a member it is not the lead instead of handing it the lead rules', async () => {
    const client = {
      call: async () => ({
        ok: true,
        result: { config: { mode: 'on' }, agents: [], worktree: null, role: 'member' }
      })
    } as unknown as RuntimeClient

    await ORCHESTRATOR_GAME_HANDLERS['game lead']({
      flags: new Map(),
      client,
      cwd: '/tmp',
      json: true
    })

    expect(JSON.parse(output.join(''))).toEqual(
      expect.objectContaining({ result: expect.objectContaining({ role: 'member', brief: null }) })
    )
  })

  it('opens a link in the system browser through the host', async () => {
    const calls: [string, unknown][] = []
    const client = {
      call: async (method: string, params: unknown) => {
        calls.push([method, params])
        return { ok: true, result: { opened: true } }
      }
    } as unknown as RuntimeClient

    await ORCHESTRATOR_GAME_HANDLERS['game open-link']({
      flags: new Map([['url', 'https://github.com/o/r/pulls']]),
      client,
      cwd: '/tmp',
      json: true
    })

    expect(calls).toEqual([['game.openLink', { url: 'https://github.com/o/r/pulls' }]])
    await expect(
      ORCHESTRATOR_GAME_HANDLERS['game open-link']({
        flags: new Map(),
        client,
        cwd: '/tmp',
        json: true
      })
    ).rejects.toThrow(/url/i)
  })

  it('says how the scene draws and on whose clock, with where each comes from', async () => {
    const state = {
      config: { mode: 'on', scene: 'quest', render: 'hd', timezone: 'America/Bogota' },
      sources: { mode: 'default', render: 'project', timezone: 'global' },
      agents: [],
      review: null,
      workItem: null,
      warnings: ['orchestratorGame.render must be classic, hd or hd-compact']
    }
    const client = {
      call: async () => ({ ok: true, result: state })
    } as unknown as RuntimeClient

    await ORCHESTRATOR_GAME_HANDLERS['game state']({
      flags: new Map(),
      client,
      cwd: '/tmp',
      json: false
    })

    const text = output.join('\n')
    expect(text).toContain('Render: hd (from project), timezone America/Bogota (from global)')
    expect(text).toContain('Warning: orchestratorGame.render must be classic, hd or hd-compact')
  })
})
