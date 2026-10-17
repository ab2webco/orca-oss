import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_INBOX_HANDLERS } from './orchestrator-game-inbox'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

const INBOX = {
  key: 'lead',
  unread: 1,
  newest: 7,
  messages: [
    {
      id: 'msg_7',
      at: '2026-10-16 10:00:07',
      from: 'CIN-1',
      to: 'lead',
      type: 'worker_done',
      subject: 'Done',
      body: 'TERMINADO CIN-1',
      unread: true
    }
  ]
}

function fakeClient(fail = false) {
  const calls: [string, unknown][] = []
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      if (fail) {
        throw new RuntimeClientError('method_not_found', 'Unknown method: game.inbox')
      }
      return { ok: true, result: { inbox: INBOX } }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const run = (client: RuntimeClient, flags: [string, string | boolean][], json = true) =>
  ORCHESTRATOR_GAME_INBOX_HANDLERS['game inbox']({
    flags: new Map(flags),
    client,
    cwd: '/repo',
    json
  })

describe('orca game inbox', () => {
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

  it('reads the caller inbox with its filters', async () => {
    const { client, calls } = fakeClient()

    await run(client, [
      ['ticket', 'cin-1'],
      ['unread', true],
      ['mark-read', true]
    ])

    expect(calls).toEqual([
      [
        'game.inbox',
        {
          worktreeId: 'wt1',
          terminalHandle: 'term_lead',
          ticket: 'CIN-1',
          unread: true,
          markRead: true
        }
      ]
    ])
    expect(JSON.parse(output.join('')).result.inbox).toEqual(INBOX)
  })

  it('prints the unread count and one line per message, the unread marked', async () => {
    const { client } = fakeClient()
    await run(client, [], false)
    const text = output.join('\n')
    expect(text).toContain('lead inbox: 1 unread')
    expect(text).toContain('* 2026-10-16 10:00:07 CIN-1 worker_done: TERMINADO CIN-1')
  })

  it('says the Orca host is too old for the game inbox instead of a bare RPC error', async () => {
    const { client } = fakeClient(true)
    await expect(run(client, [])).rejects.toThrow(/does not keep game inbox yet/)
  })
})
