import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OrcaRuntimeService } from './orca-runtime'
import { readWorktreeOrcaYaml } from '../worktree-orca-yaml'
import type { GlobalSettings } from '../../shared/types'

vi.mock('../worktree-orca-yaml', () => ({ readWorktreeOrcaYaml: vi.fn() }))

beforeEach(() => {
  vi.mocked(readWorktreeOrcaYaml).mockReset().mockResolvedValue(null)
})

type GameSettings = Partial<Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>>

function runtimeWith(settings: GameSettings) {
  const writes: [GameSettings, unknown][] = []
  const runtime = new OrcaRuntimeService({
    getSettings: () => settings,
    updateSettings: (updates: GameSettings, options: unknown) => {
      writes.push([updates, options])
    }
  } as never)
  // Why the cast: the worktree map is private, and a real one needs repos on disk.
  const internals = runtime as unknown as { getResolvedWorktreeMap: () => Promise<unknown> }
  vi.spyOn(internals, 'getResolvedWorktreeMap').mockResolvedValue(
    new Map([['w1', { id: 'w1', repoId: 'r1', path: '/repo/w1' }]])
  )
  return { runtime, writes }
}

describe('storing a game view through the runtime', () => {
  it("writes the caller repo's own layer and tells every Settings window", async () => {
    const { runtime, writes } = runtimeWith({ orchestratorGame: { render: 'hd' } })

    await expect(
      runtime.setOrchestratorGameView({ view: 'flat', scope: 'project', worktreeId: 'w1' })
    ).resolves.toEqual({ view: 'flat', scope: 'project', layer: 'local' })
    expect(writes).toEqual([
      [{ orchestratorGameProjects: { r1: { mode: 'flat' } } }, { notifyListeners: true }]
    ])
  })

  it('shows the game again for this project when its orca.yaml hides it', async () => {
    vi.mocked(readWorktreeOrcaYaml).mockResolvedValue({
      scripts: {},
      orchestratorGame: { show: false }
    })
    const { runtime, writes } = runtimeWith({})

    await runtime.setOrchestratorGameView({ view: 'zen', scope: 'project', worktreeId: 'w1' })

    expect(readWorktreeOrcaYaml).toHaveBeenCalledWith('/repo/w1', null)
    expect(writes).toEqual([
      [{ orchestratorGameProjects: { r1: { mode: 'zen', show: true } } }, { notifyListeners: true }]
    ])
  })

  it('writes every project without needing a worktree', async () => {
    const { runtime, writes } = runtimeWith({})

    await runtime.setOrchestratorGameView({ view: '2d-hd', scope: 'global' })

    expect(writes).toEqual([
      [{ orchestratorGame: { mode: 'on', render: 'hd' } }, { notifyListeners: true }]
    ])
  })

  it('refuses this project for a pane outside any repo and writes nothing', async () => {
    const { runtime, writes } = runtimeWith({})

    await expect(
      runtime.setOrchestratorGameView({ view: 'zen', scope: 'project', worktreeId: 'gone' })
    ).rejects.toThrow(/no project/)
    expect(writes).toEqual([])
  })
})
