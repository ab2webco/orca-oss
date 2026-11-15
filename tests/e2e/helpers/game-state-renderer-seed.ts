import type { ElectronApplication } from '@stablyai/playwright-test'

type RuntimeCall = (event: unknown, args: { method: string }) => Promise<unknown>
type SeededAgent = { paneKey: string } & Record<string, unknown>

export type GameStateRendererSeed = {
  /** Agents added after the real ones, as a launch would report them. */
  agents?: SeededAgent[]
  /** Fields set on the real agents, by paneKey. */
  fields?: Record<string, Record<string, unknown>>
}

/** A review in game.state's shape. */
export const seededReview = (number: number, state: string, ci: string) => ({
  provider: 'github',
  number,
  title: `PR ${number}`,
  url: `https://github.com/example/repo/pull/${number}`,
  state,
  ci
})

/**
 * Changes what the renderer reads from game.state. Why the renderer's IPC: reviews and tickets come
 * from providers no E2E host reaches, and a member reads Done only for finished work (ORCA-1205).
 */
export async function seedRendererGameState(
  app: ElectronApplication,
  seed: GameStateRendererSeed
): Promise<void> {
  await app.evaluate(({ ipcMain }, { agents = [], fields = {} }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, RuntimeCall> })
      ._invokeHandlers
    const real = handlers.get('runtime:call')!
    ipcMain.removeHandler('runtime:call')
    ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
      const response = (await real(event, args)) as {
        result?: { agents?: { paneKey: string }[] }
      }
      if (args.method === 'game.state' && response?.result?.agents) {
        response.result.agents = [
          ...response.result.agents.map((one) => ({ ...one, ...fields[one.paneKey] })),
          ...agents
        ]
      }
      return response
    })
  }, seed)
}
