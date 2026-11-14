import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'

const NOTE =
  "This scene has no Figures art, so the Team panel draws the scene's own characters in Pixel."

// ORCA-1139 criterion 4, ORCA-1150: vigilante has no Figures art, so the panel draws it in Pixel.
test('the Panel section says when the scene has no art for the chosen style', async ({
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
