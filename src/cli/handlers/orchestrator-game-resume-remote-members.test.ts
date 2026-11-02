import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_RESUME_MEMBERS_HANDLERS } from './orchestrator-game-resume-members'
import type { RuntimeClient } from '../runtime-client'

// Why: a paired host's restart slept its members' panes, and resume-members only
// reopened members on this Orca, so the lead had no way to resume them (ORCA-915).

const LEAD = { paneKey: 'tab:lead', state: 'idle', isLeader: true, displayName: 'Lead' }

const remoteMember = (ticket: string, remote: Record<string, unknown>) => ({
  paneKey: `remote:ctx_${ticket}`,
  displayName: `Nova · ${ticket}`,
  state: 'idle',
  isLeader: false,
  isMember: true,
  remote: { host: 'imac', stateKnown: true, ...remote }
})

function fakeClient(
  agents: unknown[],
  wake: { handle: string } | Error = { handle: 'term_woken' }
) {
  const calls: [string, Record<string, unknown>][] = []
  const client = {
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push([method, params])
      if (method === 'game.memberWake') {
        if (wake instanceof Error) {
          throw wake
        }
        return { ok: true, result: { wake: { status: 'woken', ...wake } } }
      }
      const results: Record<string, unknown> = {
        'game.state': {
          config: { mode: 'on' },
          agents: [LEAD, ...agents],
          lead: { autostart: false, cap: 4, agent: 'claude' },
          pausedMembers: []
        },
        'terminal.show': { terminal: { handle: 'h1' } }
      }
      return { ok: true, result: results[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const run = (client: RuntimeClient, flags: [string, string | boolean][] = []) =>
  ORCHESTRATOR_GAME_RESUME_MEMBERS_HANDLERS['game resume-members']({
    flags: new Map(flags),
    client,
    cwd: '/repo',
    json: true
  })

describe('orca game resume-members for members on a paired host', () => {
  const saved = { ...process.env }
  let output: string[] = []
  const printed = () => JSON.parse(output.join('')).result

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
    process.env.ORCA_PANE_KEY = 'tab:lead'
  })

  afterEach(() => {
    process.env = { ...saved }
    process.exitCode = undefined
    vi.restoreAllMocks()
  })

  it('wakes each member its host slept, in its own pane, and leaves running ones alone', async () => {
    const { client, calls } = fakeClient([
      remoteMember('ORCA-915', { asleep: true }),
      remoteMember('ORCA-916', {})
    ])

    await run(client)

    expect(calls.filter(([method]) => method === 'game.memberWake')).toEqual([
      ['game.memberWake', expect.objectContaining({ dispatchId: 'ctx_ORCA-915' })]
    ])
    expect(printed().members).toEqual([
      { ticket: 'ORCA-915', result: 'woken', terminal: 'term_woken', note: 'on imac' }
    ])
  })

  it('wakes only the named tickets', async () => {
    const { client, calls } = fakeClient([
      remoteMember('ORCA-915', { asleep: true }),
      remoteMember('ORCA-917', { asleep: true })
    ])

    await run(client, [['tickets', 'ORCA-917']])

    expect(calls.filter(([method]) => method === 'game.memberWake')).toEqual([
      ['game.memberWake', expect.objectContaining({ dispatchId: 'ctx_ORCA-917' })]
    ])
  })

  it('reports a host that cannot wake its member as failed, with its reason', async () => {
    const { client } = fakeClient(
      [remoteMember('ORCA-915', { asleep: true })],
      new Error(
        'The Orca Lab on imac cannot wake terminals; update it, or wake the member in its window.'
      )
    )

    await run(client)

    expect(printed().members).toEqual([
      {
        ticket: 'ORCA-915',
        result: 'failed',
        reason:
          'The Orca Lab on imac cannot wake terminals; update it, or wake the member in its window.'
      }
    ])
    expect(process.exitCode).toBe(1)
  })

  it('lists the members it would wake on a dry run, waking none', async () => {
    const { client, calls } = fakeClient([remoteMember('ORCA-915', { asleep: true })])

    await run(client, [['dry-run', true]])

    expect(printed().wake).toEqual(['ORCA-915'])
    expect(calls.some(([method]) => method === 'game.memberWake')).toBe(false)
  })
})
