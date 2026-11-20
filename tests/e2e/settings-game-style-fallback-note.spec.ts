import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'

const NOTE = "Figures always draws Orca's own art; this scene changes Pixel only."

// ORCA-1296: Figures and Office are Orca's own art whatever the scene; a themed scene says so.
test('the Panel section says a themed scene leaves Figures as Orca draws it', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await writeSettings(orcaPage, {
    uiLanguage: 'en',
    orchestratorGame: { scene: 'vigilante', panel: { look: 'game', style: 'figures' } }
  })
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'agents', repoId: null, sectionId: 'agents-game-panel' })
    state.openSettingsPage()
  })
  const section = orcaPage.locator('#agents-game-panel')
  await expect(section.getByText(NOTE)).toBeVisible({ timeout: 15_000 })

  for (const width of [1440, 768, 390, 320]) {
    await orcaPage.setViewportSize({ width, height: 900 })
    for (const theme of ['dark', 'light'] as const) {
      await writeSettings(orcaPage, { theme })
      await section.getByText(NOTE).scrollIntoViewIfNeeded()
      await orcaPage.waitForTimeout(300)
      await orcaPage.screenshot({
        path: testInfo.outputPath(`style-fallback-note-${width}-${theme}.png`)
      })
    }
  }

  await writeSettings(orcaPage, {
    orchestratorGame: { scene: 'quest', panel: { look: 'game', style: 'figures' } }
  })
  await expect(section.getByText(NOTE)).toBeHidden()
})
