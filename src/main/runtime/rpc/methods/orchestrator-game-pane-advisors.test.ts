import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATOR_GAME_PANE_ADVISORS_METHODS } from './orchestrator-game-pane-advisors'

function dispatcherWith(read: (paneKeys: string[]) => unknown) {
  const runtime = {
    getRuntimeId: () => 'runtime',
    getGamePaneAdvisors: read
  } as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({
    runtime,
    methods: ORCHESTRATOR_GAME_PANE_ADVISORS_METHODS
  })
  return (params: unknown) =>
    dispatcher.dispatch({ id: 'a', authToken: 'test', method: 'game.paneAdvisors', params })
}

describe('game.paneAdvisors', () => {
  it('hands back the reports of the panes it was asked about', async () => {
    const seen: string[][] = []
    const send = dispatcherWith((paneKeys) => {
      seen.push(paneKeys)
      return { advisors: [] }
    })

    await expect(send({ paneKeys: ['tab-a:leaf'] })).resolves.toMatchObject({
      ok: true,
      result: { advisors: [] }
    })
    expect(seen).toEqual([['tab-a:leaf']])
  })

  it('refuses a call with no pane list, or one larger than the store holds', async () => {
    const send = dispatcherWith(() => ({ advisors: [] }))

    await expect(send({})).resolves.toMatchObject({ ok: false })
    await expect(
      send({ paneKeys: Array.from({ length: 65 }, (_, index) => `pane-${index}`) })
    ).resolves.toMatchObject({ ok: false })
  })
})
