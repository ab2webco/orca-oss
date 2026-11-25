import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_HANDLERS } from './orchestrator-game'
import { formatGameInherited, gameInheritedOf } from './orchestrator-game-inherited'
import {
  LEAD,
  fakeClient,
  member,
  merged,
  stateWith
} from './orchestrator-game-fleet-test-fixtures'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'

const foundOn = (host: string, ticket: string, state = 'idle') =>
  member({
    paneKey: `remote-found:env-${host}:tab-${ticket}:leaf`,
    displayName: `${ticket} implement`,
    state,
    terminalHandle: undefined,
    found: true,
    remote: { host, environmentId: `env-${host}`, stateKnown: true },
    worktree: { id: `repo::/w/${ticket}`, branch: `fab/${ticket}`, displayName: ticket }
  })

// Why this shape: 2026-11-25, an earlier lead's finished sessions held koombea and imac after --fresh.
const repro = () =>
  stateWith({
    role: 'lead',
    agents: [
      LEAD,
      foundOn('koombea', 'ORCA-1388'),
      foundOn('koombea', 'ORCA-1391'),
      foundOn('imac', 'ORCA-1400', 'working'),
      member({
        paneKey: 'remote:env-imac:tab-1395:leaf',
        displayName: 'ORCA-1395 implement',
        state: 'idle',
        review: merged,
        remote: { host: 'imac', environmentId: 'env-imac', stateKnown: true }
      })
    ],
    lead: { autostart: false, cap: 8, agent: 'claude' },
    hosts: [
      { host: 'local', cap: 2, status: 'ok' },
      { host: 'koombea', id: 'env-koombea', cap: 4, status: 'ok' },
      { host: 'imac', id: 'env-imac', cap: 2, status: 'ok' }
    ],
    inboxes: [
      {
        key: 'lead',
        unread: 1,
        last: null,
        waiting: [
          { id: 'msg_7', from: 'ORCA-1400', subject: 'Split the PR?', at: '2026-11-25T10:00:00Z' }
        ]
      }
    ]
  })

const question = {
  id: 'oq_3',
  ticket: 'ORCA-1424',
  question: 'Merge P5 before the release?',
  options: [],
  context: null,
  askedAt: '2026-11-25T09:00:00Z',
  answer: null
}

const decision = (id: string, text: string, followUp: unknown = null) => ({
  id,
  at: '2026-11-25T12:30:00.000Z',
  ticket: 'ORCA-1424',
  decision: text,
  why: null,
  evidence: null,
  followUp
})

const trail = {
  followUps: [decision('dec_9', 'Close the koombea leftovers after P5', { doneAt: null })],
  decisions: [1, 2, 3, 4, 5, 6].map((n) => decision(`dec_${n}`, `Decision ${n}`)),
  total: 12
}

describe('game lead prints what the new lead inherits (ORCA-1429)', () => {
  const saved = { ...process.env }
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
    delete process.env.ORCA_GAME_ROLE
    delete process.env.CLAUDECODE
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-25T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    process.env = { ...saved }
  })

  it('after --fresh, lists finished and leftover sessions on paired hosts with their close commands', async () => {
    const { client, calls } = fakeClient(repro(), {
      'game.leadRegister': { registered: true },
      'game.ownerQuestions': { questions: [question], open: 1, undelivered: [] },
      'game.decisions': trail
    })

    await ORCHESTRATOR_GAME_HANDLERS['game lead']({
      flags: new Map([['fresh', true]]),
      client,
      cwd: '/repo',
      json: false
    })

    const text = output.join('\n')
    expect(text).toContain("Orca retired repo's previous lead conversation")
    const section = text.slice(text.indexOf('Inherited (from the fleet and the project record):'))
    expect(section.split('\n')).toEqual([
      'Inherited (from the fleet and the project record):',
      'Slots: 0/8 running, 7 free · local 0/2 · koombea 0/4 · imac 1/2',
      'Running (1):',
      '  ORCA-1400 on imac: working; next: found on imac: orca game adopt ORCA-1400 so lead mail reaches it',
      'Finished, pane still open (1):',
      '  ORCA-1395 on imac: PR #41 merged; orca game sweep --close',
      'Leftovers, no slot held (2):',
      '  ORCA-1388: leftover on koombea (idle, no lead): orca game adopt ORCA-1388 if its work goes on, else orca game stop ORCA-1388 closes its pane there',
      '  ORCA-1391: leftover on koombea (idle, no lead): orca game adopt ORCA-1391 if its work goes on, else orca game stop ORCA-1391 closes its pane there',
      'Waiting (2):',
      '  ORCA-1400 waiting on you 2h0m: orchestration reply --id msg_7 ("Split the PR?")',
      '  you wait on the person: oq_3 ORCA-1424 Merge P5 before the release? (asked 2026-11-25T09:00:00Z)',
      'Pending follow-ups, close with orca game decision done <id> (1):',
      '  2026-11-25T12:30 dec_9 ORCA-1424: Close the koombea leftovers after P5',
      'Recent decisions (latest 5 of 12, orca game decision list):',
      '  2026-11-25T12:30 dec_1 ORCA-1424: Decision 1',
      '  2026-11-25T12:30 dec_2 ORCA-1424: Decision 2',
      '  2026-11-25T12:30 dec_3 ORCA-1424: Decision 3',
      '  2026-11-25T12:30 dec_4 ORCA-1424: Decision 4',
      '  2026-11-25T12:30 dec_5 ORCA-1424: Decision 5'
    ])
    // Why the lead's own caller: the board resolves the project from it, as game decision list does.
    expect(calls.find(([method]) => method === 'game.decisions')?.[1]).toEqual({
      worktreeId: 'wt1',
      terminalHandle: 'term_lead'
    })
  }, 10_000)

  it('an Orca without the records still prints the brief, says what it could not read', async () => {
    const client = {
      call: async (method: string) => {
        if (method === 'game.decisions' || method === 'game.ownerQuestions') {
          throw new RuntimeClientError('method_not_found', `Unknown method: ${method}`)
        }
        return { ok: true, result: method === 'game.state' ? repro() : {} }
      }
    } as unknown as RuntimeClient

    await ORCHESTRATOR_GAME_HANDLERS['game lead']({
      flags: new Map(),
      client,
      cwd: '/repo',
      json: false
    })

    const text = output.join('\n')
    expect(text).toContain('You are the lead of repo')
    expect(text).toContain(
      'Not read from this Orca: owner questions, decisions; update Orca Lab if it is older.'
    )
  })

  it('a member and a pane that is not the lead read no records', async () => {
    process.env.ORCA_GAME_ROLE = 'member'
    const { client, calls } = fakeClient({ ...repro(), role: 'member' })

    await ORCHESTRATOR_GAME_HANDLERS['game lead']({
      flags: new Map(),
      client,
      cwd: '/repo',
      json: true
    })

    expect(calls.map(([method]) => method)).toEqual(['game.state'])
    expect(JSON.parse(output.join('')).result.inherited).toBeUndefined()
  })

  it('an empty project says so in one line, and an answer that never reached the lead shows', () => {
    const answered = { ...question, answer: { at: 'x', text: 'Yes, merge it', undelivered: true } }
    const empty = gameInheritedOf(
      stateWith({ agents: [LEAD] }) as never,
      { questions: [], undelivered: [answered] as never },
      { followUps: [], decisions: [], total: 0 },
      Date.parse('2026-11-25T12:00:00Z')
    )

    expect(formatGameInherited({ ...empty, waiting: [] }).split('\n')).toEqual([
      'Inherited (from the fleet and the project record):',
      'Slots: 0/2 running, 2 free',
      'Nothing running, finished, left over, waiting or decided yet.'
    ])
    expect(empty.waiting).toEqual(['the person answered oq_3 ORCA-1424: Yes, merge it; act on it'])
  })
})
