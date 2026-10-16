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
})
