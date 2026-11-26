import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../format', () => ({ printResult: vi.fn() }))

import { ORCHESTRATION_HANDLERS } from './orchestration'
import { ORCHESTRATOR_GAME_HANDLERS } from './orchestrator-game'
import { fakeClient, launch, stateWith } from './orchestrator-game-launch-test-fixtures'
import { printResult } from '../format'
import type { RuntimeClient } from '../runtime-client'

// Why: a CLI run from a terminal outside Orca has none of these, while the suite may run inside an Orca pane.
const IDENTITY_KEYS = [
  'ORCA_TERMINAL_HANDLE',
  'ORCA_PANE_KEY',
  'ORCA_WORKTREE_ID',
  'ORCA_GAME_ROLE',
  'CLAUDECODE'
] as const

const saved = new Map<string, string | undefined>()
let calls: string[] = []

// Why a real resolveActive: the old fallback asked the host for the focused pane and acted as it (ORCA-1411).
const client = {
  call: async (method: string) => {
    calls.push(method)
    if (method === 'terminal.resolveActive') {
      return { ok: true, result: { handle: 'term_someone_else' } }
    }
    if (method === 'game.state') {
      return {
        ok: true,
        result: {
          config: { mode: 'on' },
          agents: [],
          warnings: [],
          role: 'lead'
        }
      }
    }
    return { ok: true, result: {} }
  }
} as unknown as RuntimeClient

const run = (handler: (typeof ORCHESTRATION_HANDLERS)[string], flags: [string, string][]) =>
  handler({ flags: new Map(flags), client, cwd: '/tmp', json: true })

beforeEach(() => {
  calls = []
  vi.mocked(printResult).mockClear()
  for (const key of IDENTITY_KEYS) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
})

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('an unidentified CLI caller never acts as the active pane (ORCA-1411)', () => {
  it.each([
    [
      'orchestration send',
      [
        ['to', 'term_lead'],
        ['subject', 'hi'],
        ['type', 'status']
      ]
    ],
    [
      'orchestration reply',
      [
        ['id', 'msg_1'],
        ['body', 'ok']
      ]
    ],
    ['orchestration ask', [['question', 'which?']]],
    [
      'orchestration dispatch',
      [
        ['task', 'task_1'],
        ['to', 'term_worker']
      ]
    ]
  ] as [string, [string, string][]][])(
    '%s refuses to send as the active pane',
    async (command, flags) => {
      await expect(run(ORCHESTRATION_HANDLERS[command], flags)).rejects.toMatchObject({
        code: 'no_active_sender_terminal',
        message: expect.stringContaining('--from')
      })
      expect(calls).toEqual([])
    }
  )

  it("orchestration check refuses to read and ack the active pane's mail", async () => {
    await expect(run(ORCHESTRATION_HANDLERS['orchestration check'], [])).rejects.toMatchObject({
      code: 'no_caller_terminal',
      message: expect.stringContaining('--terminal')
    })
    expect(calls).toEqual([])
  })

  it('still runs for a caller that names its pane', async () => {
    await run(ORCHESTRATION_HANDLERS['orchestration send'], [
      ['from', 'term_me'],
      ['to', 'term_lead'],
      ['subject', 'hi'],
      ['type', 'status']
    ])
    expect(calls).not.toContain('terminal.resolveActive')
    expect(calls).toContain('orchestration.send')
  })

  it('game lead refuses before it claims the project lead', async () => {
    await expect(run(ORCHESTRATOR_GAME_HANDLERS['game lead'], [])).rejects.toMatchObject({
      code: 'no_caller_terminal',
      message: expect.stringMatching(/^Not the lead:.*ORCA_TERMINAL_HANDLE/)
    })
    expect(calls).toEqual([])
  })

  it('game launch refuses before it makes the active pane a coordinator', async () => {
    const fake = fakeClient(
      stateWith(),
      { id: 'run_1' },
      {
        'terminal.resolveActive': { handle: 'term_someone_else' }
      }
    )
    await expect(launch(fake.client)).rejects.toMatchObject({ code: 'no_active_sender_terminal' })
    const methods = fake.calls.map(([method]) => method)
    expect(methods).not.toContain('terminal.resolveActive')
    expect(methods.filter((method) => method.startsWith('orchestration.'))).toEqual([])
    // Why: the refusal comes after the name is reserved, so it must hand the name back.
    expect(methods.at(-1)).toBe('game.memberNameRelease')
  })

  it('game state never reports role lead for it', async () => {
    await run(ORCHESTRATOR_GAME_HANDLERS['game state'], [])
    const printed = vi.mocked(printResult).mock.calls[0]?.[0] as {
      result: { role?: string; warnings: string[] }
    }
    expect(printed.result.role).toBeUndefined()
    expect(printed.result.warnings).toEqual([
      expect.stringContaining('No role: Orca cannot tell which pane is calling')
    ])
  })

  it('game state keeps the role of an identified pane', async () => {
    process.env.ORCA_TERMINAL_HANDLE = 'term_me'
    await run(ORCHESTRATOR_GAME_HANDLERS['game state'], [])
    const printed = vi.mocked(printResult).mock.calls[0]?.[0] as {
      result: { role?: string }
    }
    expect(printed.result.role).toBe('lead')
  })
})
