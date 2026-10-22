import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ORCHESTRATOR_GAME_VIEW_HANDLERS } from './orchestrator-game-view'
import type { RuntimeClient } from '../runtime-client'

const view = (client: RuntimeClient, flags: [string, string | boolean][], json = false) =>
  ORCHESTRATOR_GAME_VIEW_HANDLERS['game view']({
    flags: new Map(flags),
    client,
    cwd: '/tmp',
    json
  })

describe('orca game view', () => {
  const saved = { ...process.env }
  let output: string[] = []
  let calls: [string, unknown][] = []
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { ok: true, result: { view: '2d-hd', scope: 'project', layer: 'local' } }
    }
  } as unknown as RuntimeClient

  beforeEach(() => {
    output = []
    calls = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
  })

  it('stores the view for the scope it names, for the calling pane', async () => {
    await view(client, [
      ['view', '2D-HD'],
      ['scope', 'project']
    ])

    expect(calls).toEqual([
      ['game.setView', { view: '2d-hd', scope: 'project', worktreeId: 'wt1', terminalHandle: 'h1' }]
    ])
    expect(output.join('\n')).toBe('Game view 2d-hd saved for this project (this machine)')
  })

  it('refuses an unknown view or a missing scope before calling the host', async () => {
    await expect(
      view(client, [
        ['view', 'vr'],
        ['scope', 'global']
      ])
    ).rejects.toThrow(/off, flat, zen, 2d-classic, 2d-hd/)
    await expect(view(client, [['view', 'flat']])).rejects.toThrow(/--scope project or global/)
    await expect(
      view(client, [
        ['view', 'flat'],
        ['scope', 'pane']
      ])
    ).rejects.toThrow(/--scope project or global/)
    expect(calls).toEqual([])
  })
})
