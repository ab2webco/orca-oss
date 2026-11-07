import { describe, expect, it, vi } from 'vitest'
import { teamArcadeActionsOf } from './team-panel-arcade-actions'

const target = { kind: 'local' as const }

function setup(overrides: Partial<Parameters<typeof teamArcadeActionsOf>[0]> = {}) {
  const deps = {
    play: vi.fn(async (_scope: unknown, open: (worktreeId: string) => void) => {
      open('ignored')
      return true
    }),
    keep: vi.fn(async () => true),
    openTab: vi.fn(),
    refresh: vi.fn(),
    failed: vi.fn()
  }
  const actions = teamArcadeActionsOf({
    enabled: true,
    target,
    leadWorktreeId: 'lead-wt',
    activeWorktreeId: 'active-wt',
    ...deps,
    ...overrides
  })
  return { actions, ...deps }
}

describe('teamArcadeActionsOf', () => {
  it("spends the play on the lead's project and opens the tab in the window's own worktree", async () => {
    const { actions, play, openTab, refresh } = setup()

    await actions!.play()

    expect(play.mock.calls[0]?.[0]).toEqual({ target, worktreeId: 'lead-wt' })
    expect(openTab).toHaveBeenCalledWith('active-wt')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("keeps the offer on the lead's project and reads the panel again", async () => {
    const { actions, keep, refresh } = setup()

    await actions!.keep()

    expect(keep).toHaveBeenCalledWith({ target, worktreeId: 'lead-wt' })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('says so when the host cannot be reached, and still reads the panel again', async () => {
    const { actions, failed, refresh } = setup({
      keep: vi.fn(async () => {
        throw new Error('timeout')
      })
    })

    await expect(actions!.keep()).resolves.toBeUndefined()

    expect(failed).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('offers nothing when the arcade is off, or there is no lead or window worktree', () => {
    expect(setup({ enabled: false }).actions).toBeNull()
    expect(setup({ leadWorktreeId: null }).actions).toBeNull()
    expect(setup({ activeWorktreeId: null }).actions).toBeNull()
  })
})
