import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_EVENT_HANDLERS } from './orchestrator-game-events'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

const EVENT = {
  at: '2026-10-16T12:00:00.000Z',
  kind: 'pr_opened',
  ticket: 'CIN-9',
  text: 'PR #41',
  by: 'CIN-9'
}

function fakeClient(fail = false) {
  const calls: [string, unknown][] = []
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      if (fail) {
        throw new RuntimeClientError('method_not_found', `Unknown method: ${method}`)
      }
      return method === 'game.events'
        ? { ok: true, result: { events: [EVENT] } }
        : { ok: true, result: { posted: true, event: EVENT } }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const run = (
  command: 'game events' | 'game event',
  client: RuntimeClient,
  flags: [string, string][],
  json = true
) =>
  ORCHESTRATOR_GAME_EVENT_HANDLERS[command]({ flags: new Map(flags), client, cwd: '/repo', json })

describe('orca game events and game event', () => {
  const saved = { ...process.env }
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_x'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
  })

  it("reads the caller project's events with its filters", async () => {
    const { client, calls } = fakeClient()

    await run('game events', client, [
      ['ticket', 'cin-9'],
      ['since', '2026-10-15']
    ])

    expect(calls).toEqual([
      [
        'game.events',
        { worktreeId: 'wt1', terminalHandle: 'term_x', ticket: 'CIN-9', since: '2026-10-15' }
      ]
    ])
    expect(JSON.parse(output.join('')).result.events).toEqual([EVENT])
  })

  it('prints one line per event', async () => {
    const { client } = fakeClient()
    await run('game events', client, [], false)
    expect(output.join('\n')).toContain('2026-10-16T12:00:00.000Z CIN-9 pr_opened by CIN-9: PR #41')
  })

  it('refuses a since it cannot read', async () => {
    const { client, calls } = fakeClient()
    await expect(run('game events', client, [['since', 'soonish']])).rejects.toThrow(/--since/)
    expect(calls).toEqual([])
  })

  it('posts a known kind with its text, and refuses an unknown one before calling Orca', async () => {
    const { client, calls } = fakeClient()

    await run('game event', client, [
      ['kind', 'question_parked'],
      ['text', 'Which seat map?']
    ])
    await expect(run('game event', client, [['kind', 'celebrated']])).rejects.toThrow(
      /claimed, pr_opened/
    )

    expect(calls).toEqual([
      [
        'game.eventPost',
        {
          worktreeId: 'wt1',
          terminalHandle: 'term_x',
          kind: 'question_parked',
          text: 'Which seat map?'
        }
      ]
    ])
  })

  it('says the Orca host is too old for events instead of a bare RPC error', async () => {
    const { client } = fakeClient(true)
    await expect(run('game events', client, [])).rejects.toThrow(/does not keep game events yet/)
    await expect(run('game event', client, [['kind', 'failed']])).rejects.toThrow(
      /does not keep game events yet/
    )
  })
})
