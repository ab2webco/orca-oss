/**
 * ORCA-1299: the Arcade games paint with the app's theme tokens. Switching theme repaints an open
 * game in the new theme's colours, even one waiting for its first key that paints no frames.
 */
import type { Page } from '@stablyai/playwright-test'
import type { OrchestratorGameArcadeEngine } from '../../src/shared/orchestrator-game-arcade-file'
import { expect, test } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { setTheme } from './helpers/settings-window'

const ENGINES: OrchestratorGameArcadeEngine[] = ['runner', 'snake', 'bricks', 'defense']

/** Mean brightness of the top-left corner, where every game shows its background. */
const cornerLightOf = (page: Page, engine: OrchestratorGameArcadeEngine): Promise<number> =>
  page.evaluate((game) => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      `[data-arcade-tab][data-arcade-engine="${game}"] canvas`
    )
    const data = canvas?.getContext('2d')?.getImageData(2, 2, 6, 6).data
    // Why -1 while clear: the first frame paints once the box is measured.
    if (!data || data[3] === 0) {
      return -1
    }
    let sum = 0
    for (let i = 0; i < data.length; i += 4) {
      sum += ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3
    }
    return sum / (data.length / 4)
  }, engine)

test('switching theme repaints an open Arcade game in the new colours', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  for (const engine of ENGINES) {
    await setTheme(orcaPage, 'dark')
    await orcaPage.evaluate(
      ({ id, game }) => window.__store!.getState().openGameArcadeTab(id, game),
      { id: worktreeId, game: engine }
    )
    await expect(
      orcaPage.locator(`[data-arcade-tab][data-arcade-engine="${engine}"]`)
    ).toBeVisible()
    await expect.poll(() => cornerLightOf(orcaPage, engine)).toBeGreaterThanOrEqual(0)
    const dark = await cornerLightOf(orcaPage, engine)
    await setTheme(orcaPage, 'light')
    await expect
      .poll(() => cornerLightOf(orcaPage, engine), {
        message: `${engine} repaints in light colours without a key press`
      })
      .toBeGreaterThan(dark + 100)
  }
})
