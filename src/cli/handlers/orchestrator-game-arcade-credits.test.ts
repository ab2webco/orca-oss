import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_ARCADE_CREDIT_HANDLERS } from './orchestrator-game-arcade-credits'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

function fakeClient(result: unknown) {
  const calls: [string, unknown][] = []
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { ok: true, result }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const run = (client: RuntimeClient, flags: [string, string | boolean][], json = false) =>
  ORCHESTRATOR_GAME_ARCADE_CREDIT_HANDLERS['game arcade']({
    flags: new Map(flags),
    client,
    cwd: '/repo',
    json
  })

describe('orca game arcade', () => {
  const saved = { ...process.env }
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
  })

  it("reads the lead's saved plays", async () => {
    const { client, calls } = fakeClient({ arcade: { credits: 2, offer: null } })
    await run(client, [])
    expect(calls).toEqual([['game.arcade', { worktreeId: 'wt1', terminalHandle: 'term_lead' }]])
    expect(output.join('\n')).toBe('2 saved arcade plays.')
  })

  it("sends the terminal's kept offers once to be paid", async () => {
    const { client, calls } = fakeClient({ ok: true, paid: 2, arcade: { credits: 3, offer: null } })
    await run(client, [
      ['action', 'migrate'],
      ['offers', 'r-1, r-2,,r-1']
    ])
    expect(calls[0]).toEqual([
      'game.arcade',
      { worktreeId: 'wt1', terminalHandle: 'term_lead', action: 'migrate', offers: ['r-1', 'r-2'] }
    ])
    expect(output.join('\n')).toBe('Paid 2 kept offers: 3 saved arcade plays.')
  })

  it('refuses an action it does not know and migrate without offers', async () => {
    const { client } = fakeClient({})
    await expect(run(client, [['action', 'jackpot']])).rejects.toBeInstanceOf(RuntimeClientError)
    await expect(run(client, [['action', 'migrate']])).rejects.toThrow(/--offers/)
  })
})
