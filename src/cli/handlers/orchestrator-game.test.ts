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
})
