import { test, expect } from './helpers/orca-app'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './helpers/settings-window'
import { waitForSessionReady } from './helpers/store'

// Why: a flat pane draws no scene, so neither may its preview; nor may Off picked as the default view.
test('the preview follows the default view: no scene for flat or off, the scene again for zen', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
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
  const flatNote = orcaPage.getByText('Flat draws the game as text, with no scene or characters.')
  await expect(flatNote).toBeVisible()
  await expect(orcaPage.getByRole('option')).toHaveCount(0)
  for (const theme of THEMES) {
    await setTheme(orcaPage, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      await flatNote.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      await orcaPage.screenshot({ path: testInfo.outputPath(`preview-flat-${theme}-${width}.png`) })
    }
  }

  await setWindowWidth(electronApp, orcaPage, 1440)
  await defaultView.click()
  await orcaPage.getByRole('option', { name: 'Off · light' }).click()
  await expect(
    orcaPage.getByText('The game is off, so Agent Teams panes start as plain Claude.')
  ).toBeVisible()
  await expect(orcaPage.getByRole('switch', { name: 'Rewards' })).toBeDisabled()
  await expect(orcaPage.getByRole('option')).toHaveCount(0)
  await orcaPage.screenshot({ path: testInfo.outputPath('preview-view-off-1440.png') })

  await defaultView.click()
  await orcaPage.getByRole('option', { name: 'Zen · medium' }).click()
  await expect(quest).toBeVisible()
})
