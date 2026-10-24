import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

// Source frames for the README game-view GIF: each frame is a state the
// Settings page must render for the chosen default view.
const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 800
const HOLD_MS = 900

test('the default view picker lists the views and the preview follows the pick', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await electronApp.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
    },
    { width: WINDOW_WIDTH, height: WINDOW_HEIGHT }
  )
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'agents', repoId: null })
    state.openSettingsPage()
  })
  const quest = orcaPage.getByRole('img', { name: 'Preview of Quest (built-in)' })
  await expect(quest).toBeVisible({ timeout: 15_000 })

  const frame = async (name: string): Promise<void> => {
    await orcaPage.waitForTimeout(HOLD_MS)
    await orcaPage.screenshot({ path: testInfo.outputPath(name) })
  }

  const defaultView = orcaPage.getByRole('combobox', { name: 'Default view' }).first()
  await defaultView.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await frame('01-default.png')

  await defaultView.click()
  await expect(orcaPage.getByRole('option', { name: 'Flat · light' })).toBeVisible()
  await expect(orcaPage.getByRole('option', { name: 'Off · light' })).toBeVisible()
  await frame('02-views.png')

  await orcaPage.getByRole('option', { name: 'Flat · light' }).click()
  await expect(quest).toBeHidden()
  await frame('03-flat.png')

  await defaultView.click()
  await orcaPage.getByRole('option', { name: 'Off · light' }).click()
  await expect(
    orcaPage.getByText('The game is off, so Agent Teams panes start as plain Claude.')
  ).toBeVisible()
  await frame('04-off.png')

  await defaultView.click()
  await orcaPage.getByRole('option', { name: 'Zen · medium' }).click()
  await expect(quest).toBeVisible()
})
