import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'

// ORCA-1296: the diorama's quality and its lead's pace, set in the Panel section.
test('the Panel section sets the diorama quality and the lead pace', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await writeSettings(orcaPage, {
    uiLanguage: 'en',
    orchestratorGame: { scene: 'quest', panel: { look: 'game', style: 'figures', diorama: true } }
  })
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'agents', repoId: null, sectionId: 'agents-game-panel' })
    state.openSettingsPage()
  })
  const section = orcaPage.locator('#agents-game-panel')
  const quality = section.getByRole('radiogroup', { name: 'Scene quality' })
  const pace = section.getByRole('radiogroup', { name: "Lead's pace" })
  await expect(quality).toBeVisible({ timeout: 15_000 })
  await quality.getByRole('radio', { name: 'Low resources' }).click()
  await pace.getByRole('radio', { name: 'Direct' }).click()
  await expect
    .poll(() =>
      orcaPage.evaluate(() => {
        const panel = window.__store!.getState().settings?.orchestratorGame?.panel
        return `${panel?.quality} ${panel?.pace}`
      })
    )
    .toBe('low direct')

  for (const width of [1440, 768, 390, 320]) {
    await orcaPage.setViewportSize({ width, height: 900 })
    for (const theme of ['dark', 'light'] as const) {
      await writeSettings(orcaPage, { theme })
      await pace.scrollIntoViewIfNeeded()
      await orcaPage.waitForTimeout(300)
      const overflow = await section.evaluate((n) => n.scrollWidth - n.clientWidth)
      expect(overflow, `section overflows at ${width} ${theme}`).toBeLessThanOrEqual(0)
      await section.screenshot({ path: testInfo.outputPath(`diorama-rows-${width}-${theme}.png`) })
    }
  }

  // Back to Figures in 2D: the rows go with the diorama.
  await writeSettings(orcaPage, {
    orchestratorGame: { scene: 'quest', panel: { look: 'game', style: 'figures', diorama: false } }
  })
  await expect(quality).toBeHidden()
})
