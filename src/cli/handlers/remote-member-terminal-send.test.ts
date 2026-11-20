import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  calls: [] as [string, string, unknown][],
  failWith: null as Error | null
}))
vi.mock('./orchestrator-game-host-client', () => ({
  openHostRuntimeClient: async (environmentId: string) => ({
    call: async (method: string, params: unknown) => {
      host.calls.push([environmentId, method, params])
      if (host.failWith) {
        throw host.failWith
      }
      return { id: 'h', ok: true, result: { send: { handle: 'term_remote', accepted: true } } }
    }
  })
}))

import { RuntimeClientError } from '../runtime-client'
import { LEAD, fakeClient, member, run, stateWith } from './orchestrator-game-fleet-test-fixtures'
import { sendFollowingRemoteMember } from './remote-member-terminal-send'
import { TERMINAL_HANDLERS } from './terminal'

const remoteMember = member({
  displayName: 'CIN-7',
  state: 'done',
  terminalHandle: 'term_remote',
  remote: { host: 'm1', environmentId: 'env_m1', stateKnown: true }
})

const staleNamingHost = () =>
  new RuntimeClientError('terminal_handle_stale', 'term_remote runs on m1', {
    host: 'm1',
    environmentId: 'env_m1'
  })

describe("sends to a remote member's terminal (ORCA-976)", () => {
  let output: string[] = []

  beforeEach(() => {
    output = []
    host.calls = []
    host.failWith = null
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('game push sends a remote member its prompt on its host, not on the home', async () => {
    const { client, calls } = fakeClient(stateWith({ agents: [LEAD, remoteMember] }))

    await run('game push', client)

    expect(calls.map(([method]) => method)).toEqual(['game.state'])
    expect(host.calls).toEqual([
      [
        'env_m1',
        'terminal.send',
        expect.objectContaining({ terminal: 'term_remote', text: expect.any(String), enter: true })
      ]
    ])
    expect(JSON.parse(output.join('')).result.members[0]).toEqual(
      expect.objectContaining({ row: expect.objectContaining({ ticket: 'CIN-7' }), sent: true })
    )
  })

  it('game push names the host when that host refuses the send', async () => {
    host.failWith = new RuntimeClientError('terminal_handle_stale', 'terminal_handle_stale')
    const { client } = fakeClient(stateWith({ agents: [LEAD, remoteMember] }))

    await run('game push', client)

    expect(JSON.parse(output.join('')).result.members[0]).toEqual(
      expect.objectContaining({
        sent: false,
        error: 'On paired host m1: terminal_handle_stale'
      })
    )
    expect(process.exitCode).toBe(1)
  })

  it('terminal send follows the host the home names for the handle', async () => {
    const home = vi.fn(async () => {
      throw staleNamingHost()
    })

    const sent = await sendFollowingRemoteMember({ call: home, isRemote: false } as never, {
      terminal: 'term_remote',
      text: 'continue'
    })

    expect(home).toHaveBeenCalledTimes(1)
    expect(sent.result.send.accepted).toBe(true)
    expect(host.calls).toEqual([
      ['env_m1', 'terminal.send', { terminal: 'term_remote', text: 'continue' }]
    ])
  })

  // Why: the lead read three live members on m1 as terminal_handle_stale without --environment (ORCA-1301).
  it('terminal read follows the host the home names for the handle', async () => {
    const home = vi.fn(async () => {
      throw staleNamingHost()
    })

    await TERMINAL_HANDLERS['terminal read']({
      flags: new Map([['terminal', 'term_remote']]),
      client: { call: home, isRemote: false } as never,
      cwd: '/repo',
      json: true
    })

    expect(home).toHaveBeenCalledTimes(1)
    expect(host.calls).toEqual([['env_m1', 'terminal.read', { terminal: 'term_remote' }]])
  })

  it('keeps the error of an older home that names no host, and of a remote client', async () => {
    const bare = new RuntimeClientError('terminal_handle_stale', 'terminal_handle_stale')
    await expect(
      sendFollowingRemoteMember(
        {
          call: async () => {
            throw bare
          },
          isRemote: false
        } as never,
        { terminal: 'term_x' }
      )
    ).rejects.toBe(bare)
    const named = staleNamingHost()
    await expect(
      sendFollowingRemoteMember(
        {
          call: async () => {
            throw named
          },
          isRemote: true
        } as never,
        { terminal: 'term_remote' }
      )
    ).rejects.toBe(named)
    expect(host.calls).toEqual([])
  })
})
