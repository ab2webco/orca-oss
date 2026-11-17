import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATOR_GAME_STEWARD_LOG_METHODS } from './orchestrator-game-steward-log'

function dispatcherWith(seen: unknown[]) {
  const runtime = {
    getRuntimeId: () => 'runtime',
    gameStewardLogOf: (args: unknown) => {
      seen.push(args)
      return { ticket: 'ORCA-7', entries: [] }
    }
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATOR_GAME_STEWARD_LOG_METHODS })
  return (params: unknown) =>
    dispatcher.dispatch({ id: 'a', authToken: 'test', method: 'game.stewardLog', params })
}

describe('game.stewardLog', () => {
  it("reads a ticket's log for the caller's project", async () => {
    const seen: unknown[] = []
    await expect(
      dispatcherWith(seen)({ terminalHandle: 'term_1', ticket: 'ORCA-7' })
    ).resolves.toMatchObject({ ok: true, result: { ticket: 'ORCA-7', entries: [] } })
    expect(seen).toEqual([{ terminalHandle: 'term_1', ticket: 'ORCA-7' }])
  })

  it('refuses a ticket that could leave the log folder', async () => {
    const seen: unknown[] = []
    await expect(dispatcherWith(seen)({ ticket: '../ORCA-7' })).resolves.toMatchObject({
      ok: false
    })
    expect(seen).toEqual([])
  })
})
