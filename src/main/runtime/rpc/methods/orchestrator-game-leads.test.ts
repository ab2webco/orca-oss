import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATOR_GAME_LEADS_METHODS } from './orchestrator-game-leads'

function dispatcherWith(leads: {
  register: (args: unknown) => Promise<unknown>
  list: () => unknown
}) {
  const runtime = {
    getRuntimeId: () => 'runtime',
    getGameLeads: () => leads
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_LEADS_METHODS })
  return (method: string, params: unknown) =>
    dispatcher.dispatch({ id: 'l', authToken: 'test', method, params })
}

describe('game leads RPC', () => {
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

  it('lists the live leads', async () => {
    const leads = [{ project: 'cineco', label: 'Ana', handle: 'term_a', since: 'x' }]
    const send = dispatcherWith({ register: async () => ({}), list: () => ({ leads }) })

    await expect(send('game.leads', undefined)).resolves.toMatchObject({
      ok: true,
      result: { leads }
    })
  })
})
