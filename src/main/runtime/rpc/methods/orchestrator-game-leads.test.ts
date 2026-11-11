import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATOR_GAME_LEADS_METHODS } from './orchestrator-game-leads'

function dispatcherWith(
  leads: {
    register: (args: unknown) => Promise<unknown>
    list: () => unknown
    storedLeadOf?: (caller: unknown) => Promise<unknown>
    reopen?: (args: unknown) => Promise<unknown>
  },
  delivered: unknown[] = []
) {
  const runtime = {
    getRuntimeId: () => 'runtime',
    getGameLeads: () => leads,
    getGameBoard: () => ({
      heldAnswers: {
        deliver: async (caller: unknown) => {
          delivered.push(caller)
          return []
        }
      }
    })
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_LEADS_METHODS })
  return (method: string, params: unknown) =>
    dispatcher.dispatch({ id: 'l', authToken: 'test', method, params })
}

describe('game leads RPC', () => {
  // Why (ORCA-1100): an answer held while the project had no lead must reach the one taking over.
  it.each([
    [{ registered: true }, 'term_b'],
    [{ registered: false, live: { handle: 'term_a' } }, 'term_a'],
    [{ registered: false, resumed: { handle: 'term_c' } }, 'term_c']
  ])('hands held owner answers to the lead after %j', async (outcome, lead) => {
    const delivered: unknown[] = []
    const send = dispatcherWith(
      { register: async () => outcome, list: () => ({ leads: [] }) },
      delivered
    )

    await send('game.leadRegister', { terminalHandle: 'term_b', project: 'p', label: 'L' })

    expect(delivered).toEqual([{ terminalHandle: lead }])
  })

  it('hands nothing over when the caller did not become a lead', async () => {
    const delivered: unknown[] = []
    const send = dispatcherWith(
      { register: async () => ({ registered: false }), list: () => ({ leads: [] }) },
      delivered
    )

    await send('game.leadRegister', { terminalHandle: 'term_m', project: 'p', label: 'L' })

    expect(delivered).toEqual([])
  })

  it("registers the caller's lead with its project name and label", async () => {
    const seen: unknown[] = []
    const send = dispatcherWith({
      register: async (args) => {
        seen.push(args)
        return { registered: true }
      },
      list: () => ({ leads: [] })
    })

    await expect(
      send('game.leadRegister', { terminalHandle: 'term_a', project: 'cineco', label: 'Ana' })
    ).resolves.toMatchObject({ ok: true, result: { registered: true } })
    expect(seen).toEqual([
      { worktreeId: undefined, terminalHandle: 'term_a', project: 'cineco', label: 'Ana' }
    ])
    await expect(send('game.leadRegister', { label: 'Ana' })).resolves.toMatchObject({ ok: false })
  })

  it('passes a claim through and returns where the lead lives instead', async () => {
    const seen: unknown[] = []
    const send = dispatcherWith({
      register: async (args) => {
        seen.push(args)
        return { registered: false, live: { handle: 'term_a' } }
      },
      list: () => ({ leads: [] })
    })

    await expect(
      send('game.leadRegister', {
        terminalHandle: 'term_b',
        project: 'cineco',
        label: 'Ana',
        claim: true
      })
    ).resolves.toMatchObject({
      ok: true,
      result: { registered: false, live: { handle: 'term_a' } }
    })
    expect(seen).toEqual([
      {
        worktreeId: undefined,
        terminalHandle: 'term_b',
        project: 'cineco',
        label: 'Ana',
        claim: true
      }
    ])
  })

  it('passes a fresh claim through, so the host rotates the lead (ORCA-822)', async () => {
    const seen: unknown[] = []
    const send = dispatcherWith({
      register: async (args) => {
        seen.push(args)
        return { registered: true }
      },
      list: () => ({ leads: [] })
    })

    await send('game.leadRegister', {
      terminalHandle: 'term_b',
      project: 'cineco',
      label: 'Ana',
      claim: true,
      fresh: true
    })

    expect(seen).toEqual([
      {
        worktreeId: undefined,
        terminalHandle: 'term_b',
        project: 'cineco',
        label: 'Ana',
        claim: true,
        fresh: true
      }
    ])
  })

  it("reads the stored lead of the worktree's project (ORCA-717)", async () => {
    const callers: unknown[] = []
    const send = dispatcherWith({
      register: async () => ({}),
      list: () => ({ leads: [] }),
      storedLeadOf: async (caller: unknown) => {
        callers.push(caller)
        return { accountId: 'acct-glm' }
      }
    })

    await expect(send('game.leadStored', { worktreeId: 'wt-1' })).resolves.toMatchObject({
      ok: true,
      result: { stored: { accountId: 'acct-glm' } }
    })
    expect(callers).toEqual([{ worktreeId: 'wt-1' }])
  })

  // Why (ORCA-717): the + menu reopens the kept lead with no pane of its own.
  it('reopens the kept lead for a worktree and hands it held answers', async () => {
    const delivered: unknown[] = []
    const calls: unknown[] = []
    const send = dispatcherWith(
      {
        register: async () => ({}),
        list: () => ({ leads: [] }),
        reopen: async (args: unknown) => {
          calls.push(args)
          return { registered: false, resumed: { handle: 'term_r' } }
        }
      },
      delivered
    )

    await expect(
      send('game.leadReopen', { worktreeId: 'wt-1', project: 'orca-oss', label: '' })
    ).resolves.toMatchObject({ ok: true, result: { resumed: { handle: 'term_r' } } })
    expect(calls).toEqual([{ worktreeId: 'wt-1', project: 'orca-oss', label: '' }])
    expect(delivered).toEqual([{ terminalHandle: 'term_r' }])
  })

  it('lists the live leads', async () => {
    const leads = [{ project: 'cineco', label: 'Ana', handle: 'term_a', since: 'x' }]
    const send = dispatcherWith({ register: async () => ({}), list: () => ({ leads }) })

    await expect(send('game.leads', undefined)).resolves.toMatchObject({
      ok: true,
      result: { leads }
    })
  })
})
