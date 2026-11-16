import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATOR_GAME_EFFORT_PLAN_METHODS } from './orchestrator-game-effort-plan'

function dispatcherWith(handle: (args: unknown) => unknown) {
  const runtime = {
    getRuntimeId: () => 'runtime',
    gameEffortPlan: handle
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_EFFORT_PLAN_METHODS })
  return (params: unknown) =>
    dispatcher.dispatch({ id: 'a', authToken: 'test', method: 'game.effortPlan', params })
}

const phase = { phase: 'map', model: 'claude-sonnet-5-5', effort: 'medium', why: 'read first' }

describe('game.effortPlan', () => {
  it('reads a ticket plan when no plan is sent', async () => {
    const seen: unknown[] = []
    const send = dispatcherWith((args) => {
      seen.push(args)
      return { ticket: 'ORCA-7', known: true, plan: null }
    })
    await expect(send({ terminalHandle: 'term_1', ticket: 'ORCA-7' })).resolves.toMatchObject({
      ok: true,
      result: { ticket: 'ORCA-7', plan: null }
    })
    expect(seen).toEqual([{ worktreeId: undefined, terminalHandle: 'term_1', ticket: 'ORCA-7' }])
  })

  it('passes a written plan on as the lead plan', async () => {
    const seen: unknown[] = []
    const send = dispatcherWith((args) => {
      seen.push(args)
      return { ticket: 'ORCA-7', known: true, plan: null }
    })
    await send({ ticket: 'ORCA-7', phases: [phase] })
    expect(seen).toEqual([
      {
        worktreeId: undefined,
        terminalHandle: undefined,
        ticket: 'ORCA-7',
        plan: { source: 'lead', kind: null, phases: [phase] }
      }
    ])
  })

  it('refuses a plan this Orca cannot read whole, and a bad ticket id', async () => {
    const send = dispatcherWith(() => ({}))
    await expect(
      send({ ticket: 'ORCA-7', phases: [{ ...phase, phase: 'deploy' }] })
    ).resolves.toMatchObject({ ok: false })
    await expect(send({ ticket: 'ORCA-7', phases: [] })).resolves.toMatchObject({ ok: false })
    await expect(send({ ticket: '../x' })).resolves.toMatchObject({ ok: false })
  })
})
