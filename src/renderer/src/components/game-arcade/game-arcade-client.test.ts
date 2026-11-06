import { afterEach, describe, expect, it, vi } from 'vitest'
import { playSavedArcadeRun, readGameArcadeCredits } from './game-arcade-client'

const scope = { target: { kind: 'local' as const }, worktreeId: 'wt-1' }

function stubRuntime(reply: (params: unknown) => unknown) {
  const call = vi.fn(async ({ params }: { method: string; params?: unknown }) => reply(params))
  vi.stubGlobal('window', { api: { runtime: { call } } })
  return call
}

const ok = (result: unknown) => ({ id: 'r1', ok: true, result, _meta: { runtimeId: 'rt' } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readGameArcadeCredits', () => {
  it("reads the project's saved plays and parses what another build sends", async () => {
    stubRuntime(() => ok({ arcade: { credits: 2, offer: { provider: 'github', number: 9 } } }))
    await expect(readGameArcadeCredits(scope)).resolves.toEqual({
      credits: 2,
      offer: { provider: 'github', number: 9 }
    })
    stubRuntime(() => ok({ arcade: null }))
    await expect(readGameArcadeCredits(scope)).resolves.toBeNull()
  })

  it('reads none from a host too old to keep credits', async () => {
    stubRuntime(() => ({
      id: 'r1',
      ok: false,
      error: { code: 'method_not_found', message: 'Unknown method: game.arcade' },
      _meta: { runtimeId: 'rt' }
    }))
    await expect(readGameArcadeCredits(scope)).resolves.toBeNull()
  })
})

describe('playSavedArcadeRun', () => {
  it('spends one credit on the host, then opens the tab', async () => {
    const call = stubRuntime(() => ok({ ok: true, arcade: { credits: 0, offer: null } }))
    const open = vi.fn()
    await expect(playSavedArcadeRun(scope, open)).resolves.toBe(true)
    expect(call.mock.calls[0]?.[0]).toMatchObject({
      method: 'game.arcade',
      params: { worktreeId: 'wt-1', action: 'play' }
    })
    expect(open).toHaveBeenCalledWith('wt-1')
  })

  it('opens nothing when no credit was left to spend', async () => {
    stubRuntime(() => ok({ ok: false, arcade: { credits: 0, offer: null } }))
    const open = vi.fn()
    await expect(playSavedArcadeRun(scope, open)).resolves.toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})
