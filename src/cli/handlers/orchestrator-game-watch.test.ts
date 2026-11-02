import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_WATCH_HANDLERS } from './orchestrator-game-watch'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

const GONE = new RuntimeClientError('runtime_unavailable', 'Orca closed')

/** Answers each `game.fleetWait` with the next reply, then fails as a closed Orca does. */
function fakeClient(replies: { version: number; changed: boolean }[]) {
  const calls: [string, unknown, unknown][] = []
  const client = {
    call: async (method: string, params: unknown, options: unknown) => {
      calls.push([method, params, options])
      const reply = replies.shift()
      if (!reply) {
        throw GONE
      }
      return { ok: true, result: reply }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const run = (client: RuntimeClient) =>
  ORCHESTRATOR_GAME_WATCH_HANDLERS['game watch']({
    flags: new Map(),
    client,
    cwd: '/repo',
    json: false
  })

describe('orca game watch', () => {
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints one line per fleet change, and none for a quiet wait', async () => {
    const { client, calls } = fakeClient([
      { version: 3, changed: false },
      { version: 4, changed: true },
      { version: 4, changed: false },
      { version: 6, changed: true }
    ])

    await expect(run(client)).rejects.toBe(GONE)

    expect(output).toEqual(['ready 3', 'fleet 4', 'fleet 6'])
    expect(calls.map(([method, params]) => [method, params])).toEqual([
      ['game.fleetWait', {}],
      ['game.fleetWait', { since: 3, timeoutMs: 25_000 }],
      ['game.fleetWait', { since: 4, timeoutMs: 25_000 }],
      ['game.fleetWait', { since: 4, timeoutMs: 25_000 }],
      ['game.fleetWait', { since: 6, timeoutMs: 25_000 }]
    ])
  })

  it('gives the socket longer than the host holds the wait', async () => {
    const { client, calls } = fakeClient([
      { version: 0, changed: false },
      { version: 0, changed: false }
    ])

    await expect(run(client)).rejects.toBe(GONE)

    expect(calls[1]?.[2]).toEqual({ timeoutMs: 35_000 })
  })
})
