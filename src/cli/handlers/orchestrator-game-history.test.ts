import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_HISTORY_HANDLERS } from './orchestrator-game-history'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

const RECORD = {
  ticket: 'CIN-9',
  repo: 'cineco-frontend',
  branch: 'cin-9',
  agent: 'codex',
  account: 'bo@example.com',
  launchedAt: '2026-10-16 09:00:00',
  endedAt: '2026-10-16T12:00:00.000Z',
  outcome: 'qa',
  pr: '#41 merged',
  lastReport: 'Merged, moved to QA'
}

function fakeClient(fail = false) {
  const calls: [string, unknown][] = []
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      if (fail) {
        throw new RuntimeClientError('method_not_found', 'Unknown method: game.history')
      }
      return { ok: true, result: { records: [RECORD] } }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const run = (client: RuntimeClient, flags: [string, string][], json = true) =>
  ORCHESTRATOR_GAME_HISTORY_HANDLERS['game history']({
    flags: new Map(flags),
    client,
    cwd: '/repo',
    json
  })

describe('orca game history', () => {
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

  it("reads the caller project's history with its filters", async () => {
    const { client, calls } = fakeClient()

    await run(client, [
      ['ticket', 'cin-9'],
      ['since', '2026-10-15']
    ])

    expect(calls).toEqual([
      [
        'game.history',
        { worktreeId: 'wt1', terminalHandle: 'term_lead', ticket: 'CIN-9', since: '2026-10-15' }
      ]
    ])
    expect(JSON.parse(output.join('')).result.records).toEqual([RECORD])
  })

  it('refuses a since it cannot read', async () => {
    const { client, calls } = fakeClient()
    await expect(run(client, [['since', 'yesterday-ish']])).rejects.toThrow(/--since/)
    expect(calls).toEqual([])
  })

  it('prints one line per member and its last report', async () => {
    const { client } = fakeClient()

    await run(client, [], false)

    const text = output.join('\n')
    expect(text).toContain('CIN-9 qa')
    expect(text).toContain('codex · bo@example.com')
    expect(text).toContain('#41 merged')
    expect(text).toContain('Merged, moved to QA')
  })

  it('says the Orca host is too old for history instead of a bare RPC error', async () => {
    const { client } = fakeClient(true)
    await expect(run(client, [])).rejects.toThrow(/does not keep game history yet/)
  })
})
