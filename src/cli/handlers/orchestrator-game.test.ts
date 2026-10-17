import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_HANDLERS } from './orchestrator-game'
import type { RuntimeClient } from '../runtime-client'

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
      warnings: ['orchestratorGame.render must be classic or hd']
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
    expect(text).toContain('Warning: orchestratorGame.render must be classic or hd')
  })
})
