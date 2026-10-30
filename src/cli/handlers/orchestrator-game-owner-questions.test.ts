import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_OWNER_QUESTION_HANDLERS } from './orchestrator-game-owner-questions'
import { REPEATED_FLAG_SEPARATOR } from '../args'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

const QUESTION = {
  id: 'oq_1',
  ticket: 'CIN-1',
  question: 'Ship the arcade in lab.111?',
  options: ['Yes', 'Wait'],
  context: 'PR #41',
  askedAt: '2026-10-29T10:00:00.000Z',
  answer: null
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

const run = (
  command: string,
  client: RuntimeClient,
  flags: [string, string | boolean][],
  json = true
) =>
  ORCHESTRATOR_GAME_OWNER_QUESTION_HANDLERS[command]({
    flags: new Map(flags),
    client,
    cwd: '/repo',
    json
  })

describe('orca game owner questions', () => {
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

  it('asks with the ticket, every option and the context', async () => {
    const { client, calls } = fakeClient({ question: QUESTION })

    await run(
      'game ask-owner',
      client,
      [
        ['ticket', 'cin-1'],
        ['question', 'Ship the arcade in lab.111?'],
        ['option', `Yes${REPEATED_FLAG_SEPARATOR}Wait`],
        ['context', 'PR #41']
      ],
      false
    )

    expect(calls).toEqual([
      [
        'game.ownerAsk',
        {
          worktreeId: 'wt1',
          terminalHandle: 'term_lead',
          ticket: 'CIN-1',
          question: 'Ship the arcade in lab.111?',
          options: ['Yes', 'Wait'],
          context: 'PR #41'
        }
      ]
    ])
    expect(output.join('\n')).toContain('Asked the person oq_1 (CIN-1)')
  })

  it('refuses an ask without a question before calling Orca', async () => {
    const { client, calls } = fakeClient({})
    await expect(run('game ask-owner', client, [])).rejects.toThrow(/--question/)
    expect(calls).toEqual([])
  })

  it('lists open questions with their age and numbered options', async () => {
    const { client, calls } = fakeClient({ questions: [QUESTION], open: 1 })

    await run('game owner-questions', client, [['all', true]], false)

    expect(calls[0]).toEqual([
      'game.ownerQuestions',
      { worktreeId: 'wt1', terminalHandle: 'term_lead', all: true }
    ])
    const text = output.join('\n')
    expect(text).toContain('1 open question for the person')
    expect(text).toContain('oq_1 CIN-1 asked 2026-10-29T10:00:00.000Z: Ship the arcade in lab.111?')
    expect(text).toContain('  1) Yes  2) Wait')
    expect(text).toContain('  PR #41')
  })

  it('answers by option number or with text, never both', async () => {
    const answered = { question: { ...QUESTION, answer: { text: 'Wait', at: 'x' } } }
    const { client, calls } = fakeClient({ ...answered, delivered: true, repeated: false })

    await run(
      'game answer-owner',
      client,
      [
        ['id', 'oq_1'],
        ['pick', '2']
      ],
      false
    )
    await run('game answer-owner', client, [
      ['id', 'oq_1'],
      ['answer', 'Later']
    ])
    await expect(
      run('game answer-owner', client, [
        ['id', 'oq_1'],
        ['pick', '2'],
        ['answer', 'x']
      ])
    ).rejects.toThrow(/either --pick <n> or --answer/)
    await expect(
      run('game answer-owner', client, [
        ['id', 'oq_1'],
        ['pick', 'two']
      ])
    ).rejects.toThrow(/--pick/)

    expect(calls.map(([, params]) => params)).toEqual([
      { worktreeId: 'wt1', terminalHandle: 'term_lead', id: 'oq_1', option: 2 },
      { worktreeId: 'wt1', terminalHandle: 'term_lead', id: 'oq_1', text: 'Later' }
    ])
    expect(output[0]).toContain('Answered oq_1: Wait. The lead was told.')
  })

  it('says the Orca host is too old instead of a bare RPC error', async () => {
    const { client } = fakeClient({}, true)
    await expect(run('game owner-questions', client, [])).rejects.toThrow(
      /does not keep game owner questions yet/
    )
  })
})
