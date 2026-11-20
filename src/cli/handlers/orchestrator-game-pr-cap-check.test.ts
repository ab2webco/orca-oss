import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { RuntimeClientError } from '../runtime-client'
import { ORCHESTRATOR_GAME_PR_CAP_HANDLERS } from './orchestrator-game-pr-cap-check'

const check = (call: (method: string, params: unknown) => Promise<unknown>) =>
  ORCHESTRATOR_GAME_PR_CAP_HANDLERS['game pr-cap-check']({
    flags: new Map(),
    client: { call } as unknown as RuntimeClient,
    cwd: '/repo',
    json: false
  })

describe('orca game pr-cap-check (ORCA-1301)', () => {
  const saved = { ...process.env }
  let stderr: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    process.exitCode = undefined
    process.env.ORCA_TERMINAL_HANDLE = 'term_member'
    process.env.ORCA_PANE_KEY = 'tab-1:leaf-1'
    delete process.env.ORCA_GAME_ROLE
  })

  afterEach(() => {
    process.env = { ...saved }
    process.exitCode = undefined
    vi.restoreAllMocks()
  })

  it("asks the host with the pane's own handle and exits 3 with the refusal at the cap", async () => {
    const call = vi.fn(async () => ({ ok: true, result: { member: true, open: 6, cap: 6 } }))
    await check(call)
    expect(call).toHaveBeenCalledWith('game.prCapCheck', {
      terminalHandle: 'term_member',
      paneKey: 'tab-1:leaf-1'
    })
    expect(process.exitCode).toBe(3)
    expect(String(stderr.mock.calls[0]?.[0])).toContain('6 open PRs and its cap is 6')
  })

  it('exits 0 and prints nothing for the lead, a plain session, or a member under the cap', async () => {
    await check(async () => ({ ok: true, result: { member: false } }))
    await check(async () => ({ ok: true, result: { member: true, open: 2, cap: 6 } }))
    expect(process.exitCode).toBeUndefined()
    expect(stderr).not.toHaveBeenCalled()
  })

  it('lets gh run and says so when an older host has no game.prCapCheck', async () => {
    await check(async () => {
      throw new RuntimeClientError('method_not_found', 'Unknown method: game.prCapCheck')
    })
    expect(process.exitCode).toBe(4)
    expect(String(stderr.mock.calls[0]?.[0])).toMatch(
      /did not check this project's open-PR cap \(Unknown method: game\.prCapCheck\), so gh pr create runs/
    )
  })
})
