import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_FLEET_HANDLERS } from './orchestrator-game-fleet'
import type { RuntimeClient } from '../runtime-client'
import { DEFAULT_GAME_LEAD } from '../../shared/orchestrator-game-lead'

const stateWithPrs = (total: number) => ({
  config: { mode: 'on' },
  agents: [],
  worktree: { id: 'wt1', path: '/repo', branch: 'main', displayName: 'cineco' },
  project: {
    reviews: { provider: 'github', total, url: null, items: [] },
    todo: { provider: 'jira', total: 0, url: null, items: [] }
  },
  lead: { ...DEFAULT_GAME_LEAD, cap: 2 }
})

// Why: a dry-run wave reads only game.state, so one canned read is the whole client.
const dryRunWave = (state: unknown) => {
  const client = { call: async () => ({ ok: true, result: state }) } as unknown as RuntimeClient
  return ORCHESTRATOR_GAME_FLEET_HANDLERS['game wave']({
    flags: new Map([['dry-run', true]]),
    client,
    cwd: '/repo',
    json: true
  })
}

describe('game wave and game launch at the open-PR cap (ORCA-780)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('wave warns on stderr when open PRs reach the cap, without failing the plan', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await dryRunWave(stateWithPrs(2))

    expect(warn).toHaveBeenCalledWith(
      'Warning: 2 open PRs reach the cap of 2: finish them to merge before launching another ticket'
    )
  })

  it('wave stays silent while the open PRs are below the cap', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await dryRunWave(stateWithPrs(1))

    expect(warn).not.toHaveBeenCalled()
  })
})
