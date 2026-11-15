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

  // Why: ORCA-1214: the lead's fleet and merge-queue watch lived in a script outside Orca.
  describe('--lead', () => {
    const idleNoPr = {
      paneKey: 'p',
      displayName: 'CIN-1 Cartelera',
      agentType: 'claude',
      state: 'idle',
      toolName: null,
      isLeader: false,
      isMember: true,
      terminalHandle: 'term_1'
    }

    function leadClient(waits: { version: number; changed: boolean; afterMs?: number }[]) {
      const calls: string[] = []
      const client = {
        call: async (method: string) => {
          calls.push(method)
          if (method === 'game.state') {
            return { ok: true, result: { agents: [idleNoPr], lead: { cap: 4 } } }
          }
          const reply = waits.shift()
          if (!reply) {
            throw GONE
          }
          if (reply.afterMs) {
            vi.setSystemTime(Date.now() + reply.afterMs)
          }
          return { ok: true, result: { version: reply.version, changed: reply.changed } }
        }
      } as unknown as RuntimeClient
      return { client, calls }
    }

    const runLead = (client: RuntimeClient) =>
      ORCHESTRATOR_GAME_WATCH_HANDLERS['game watch']({
        flags: new Map([['lead', true]]),
        client,
        cwd: '/repo',
        json: false
      })

    it('prints each alert once and no fleet ticks, which would wake the lead for nothing', async () => {
      const { client } = leadClient([
        { version: 1, changed: false },
        { version: 2, changed: true },
        { version: 3, changed: true }
      ])

      await expect(runLead(client)).rejects.toBe(GONE)

      expect(output).toEqual(['ready 1', 'alert CIN-1 idle with no PR: push'])
    })

    it('reads the state on each fleet change, and on a quiet fleet once a minute at most', async () => {
      vi.useFakeTimers({ now: Date.parse('2026-11-14T20:00:00Z'), toFake: ['Date'] })
      const { client, calls } = leadClient([
        { version: 1, changed: false },
        { version: 1, changed: false, afterMs: 30_000 },
        { version: 1, changed: false, afterMs: 31_000 },
        { version: 2, changed: true }
      ])
      await expect(runLead(client)).rejects.toBe(GONE)
      vi.useRealTimers()

      expect(calls).toEqual([
        'game.fleetWait',
        'game.state',
        'game.fleetWait',
        'game.fleetWait',
        'game.state',
        'game.fleetWait',
        'game.state',
        'game.fleetWait'
      ])
    })
  })
})
