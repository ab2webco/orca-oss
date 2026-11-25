import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_DECISION_HANDLERS } from './orchestrator-game-decisions'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

const ROW = {
  id: 'dec_1',
  at: '2026-11-25T10:00:00.000Z',
  ticket: 'ORCA-7',
  decision: 'Split into 3 PRs',
  why: '~900 lines',
  evidence: 'PR #41',
  followUp: null
}
const PENDING = {
  ...ROW,
  id: 'dec_2',
  decision: 'Drop the flag',
  why: null,
  evidence: null,
  followUp: { doneAt: null }
}

function fakeClient(result: unknown, fail = false) {
  const calls: [string, unknown][] = []
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      if (fail) {
        throw new RuntimeClientError('method_not_found', `Unknown method: ${method}`)
      }
      return { ok: true, result }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const run = (command: string, client: RuntimeClient, flags: [string, string | boolean][]) =>
  ORCHESTRATOR_GAME_DECISION_HANDLERS[command]({
    flags: new Map(flags),
    client,
    cwd: '/repo',
    json: false
  })

describe('orca game decision', () => {
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

  it('records a follow-up with its ticket and sends no field the person left out', async () => {
    const { client, calls } = fakeClient({ decision: PENDING })
    await run('game decision add', client, [
      ['follow-up', 'Drop the flag'],
      ['ticket', 'orca-7']
    ])

    expect(calls).toEqual([
      [
        'game.decisionAdd',
        {
          worktreeId: 'wt1',
          terminalHandle: 'term_lead',
          decision: 'Drop the flag',
          followUp: true,
          ticket: 'ORCA-7'
        }
      ]
    ])
    expect(output.join('\n')).toContain('Recorded follow-up dec_2 (ORCA-7)')
    expect(output.join('\n')).toContain('`orca game decision done dec_2`')
  })

  it('needs exactly one of --decision and --follow-up', async () => {
    const { client, calls } = fakeClient({})
    await expect(run('game decision add', client, [])).rejects.toThrow('either --decision')
    await expect(
      run('game decision add', client, [
        ['decision', 'a'],
        ['follow-up', 'b']
      ])
    ).rejects.toThrow('either --decision')
    expect(calls).toEqual([])
  })

  it('prints pending follow-ups, then the decisions with why and evidence', async () => {
    const { client } = fakeClient({ followUps: [PENDING], decisions: [ROW], total: 21 })
    await run('game decision list', client, [['all', false]])

    expect(output.join('\n')).toBe(
      [
        '1 pending follow-up',
        '2026-11-25T10:00:00.000Z dec_2 ORCA-7: Drop the flag',
        'latest 1 of 21 decisions, newest first (--all for every one)',
        '2026-11-25T10:00:00.000Z dec_1 ORCA-7: Split into 3 PRs',
        '  why: ~900 lines',
        '  evidence: PR #41'
      ].join('\n')
    )
  })

  it('tells the lead to update an Orca that keeps no decision trail', async () => {
    const { client } = fakeClient(null, true)
    await expect(run('game decision list', client, [])).rejects.toThrow(
      'does not keep game decisions yet'
    )
  })
})
