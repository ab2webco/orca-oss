import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatGameCharacters,
  ORCHESTRATOR_GAME_CHARACTERS_HANDLERS
} from './orchestrator-game-characters'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'
import type { GameCharacterRow } from '../../shared/orchestrator-game-characters'

const ARTHUR: GameCharacterRow = {
  key: 'arthur',
  name: 'Arthur',
  tickets: 3,
  prsOpened: 2,
  prsMerged: 1,
  outcomes: { merged: 1, qa: 1, stopped: 1, failed: 0, limited: 0 },
  workedMs: 95 * 60_000,
  xp: 150,
  lastAt: '2026-10-21T09:00:00.000Z',
  recent: [
    {
      ticket: 'CIN-2',
      outcome: 'qa',
      pr: '#42 open',
      endedAt: '2026-10-21T09:00:00.000Z',
      workedMs: null
    }
  ],
  level: { level: 2, into: 50, need: 200 },
  current: { ticket: 'CIN-7' }
}

const MERLIN: GameCharacterRow = {
  ...ARTHUR,
  key: 'merlin',
  name: 'Merlin',
  tickets: 0,
  prsOpened: 0,
  prsMerged: 0,
  outcomes: { merged: 0, qa: 0, stopped: 0, failed: 0, limited: 0 },
  workedMs: 0,
  xp: 0,
  lastAt: '',
  recent: [],
  level: { level: 1, into: 0, need: 100 },
  current: null
}

function fakeClient(fail = false) {
  const calls: [string, unknown][] = []
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      if (fail) {
        throw new RuntimeClientError('method_not_found', 'Unknown method: game.characters')
      }
      return { ok: true, result: { characters: [ARTHUR, MERLIN] } }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const run = (client: RuntimeClient, json = true) =>
  ORCHESTRATOR_GAME_CHARACTERS_HANDLERS['game characters']({
    flags: new Map(),
    client,
    cwd: '/repo',
    json
  })

describe('orca game characters', () => {
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

  it("reads the caller project's characters from the host", async () => {
    const { client, calls } = fakeClient()
    await run(client)

    expect(calls).toEqual([['game.characters', { worktreeId: 'wt1', terminalHandle: 'term_lead' }]])
    expect(
      JSON.parse(output.join('')).result.characters.map((one: { key: string }) => one.key)
    ).toEqual(['arthur', 'merlin'])
  })

  it('says an older Orca keeps no characters', async () => {
    const { client } = fakeClient(true)

    await expect(run(client)).rejects.toMatchObject({ code: 'incompatible_runtime' })
  })
})

describe('formatGameCharacters', () => {
  it('prints each character with its current task and totals', () => {
    expect(formatGameCharacters({ characters: [ARTHUR, MERLIN] })).toBe(
      [
        'Arthur  Lv 2 · 150 XP · on CIN-7',
        '  3 tickets · 2 PRs, 1 merged · 1h 35m · merged 1, qa 1, stopped 1',
        '  last: CIN-2 qa #42 open',
        'Merlin  Lv 1 · 0 XP · free',
        '  no tasks yet'
      ].join('\n')
    )
  })

  it('says when no character has worked yet', () => {
    expect(formatGameCharacters({ characters: [] })).toBe('No characters have worked here yet.')
  })
})
