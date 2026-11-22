import { test, expect } from './helpers/orca-app'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './helpers/settings-window'
import { waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'

// Why: a flat pane draws no scene, so the band group and its preview go; Off also drops what the mod reads.
test('the preview follows the default view: no band group for flat or off, the scene again for zen', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  // Why: the band is off by default (ORCA-1148), and the preview this checks is the band's.
  await writeSettings(orcaPage, { orchestratorGame: { band: true } })
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'agents', repoId: null })
    state.openSettingsPage()
  })
  const quest = orcaPage.getByRole('img', { name: 'Preview of Quest (built-in)' })
  await expect(quest).toBeVisible({ timeout: 15_000 })

  const defaultView = orcaPage.getByRole('combobox', { name: 'Default view' }).first()
  await defaultView.click()
  await orcaPage.getByRole('option', { name: 'Flat · light' }).click()
  await expect(quest).toBeHidden()
  const bandGroup = orcaPage.locator('[data-game-group="band"]')
  await expect(bandGroup).toHaveCount(0)
  await expect(orcaPage.getByRole('switch', { name: 'Rewards' })).toBeVisible()
  await expect(orcaPage.getByRole('option')).toHaveCount(0)
  for (const theme of THEMES) {
    await setTheme(orcaPage, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      await defaultView.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      await orcaPage.screenshot({ path: testInfo.outputPath(`preview-flat-${theme}-${width}.png`) })
    }
  }

  await setWindowWidth(electronApp, orcaPage, 1440)
  await defaultView.click()
  await orcaPage.getByRole('option', { name: 'Off · light' }).click()
  await expect(bandGroup).toHaveCount(0)
  await expect(orcaPage.getByRole('switch', { name: 'Rewards' })).toHaveCount(0)
  await expect(orcaPage.getByRole('option')).toHaveCount(0)
  await orcaPage.screenshot({ path: testInfo.outputPath('preview-view-off-1440.png') })

  await defaultView.click()
  await orcaPage.getByRole('option', { name: 'Zen · medium' }).click()
  await expect(quest).toBeVisible()
})
