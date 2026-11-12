import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { CLIP_ARGS, showcaseClip } from './helpers/showcase-clip'
import { createShowcaseRepo } from './helpers/showcase-repo'

test.use({ seedTestRepo: false, orcaAppExtraArgs: CLIP_ARGS })

// The README and site game-view clip: each beat is a state the Settings page must render for
// the chosen default view.
const WINDOW_WIDTH = 1440
const WINDOW_HEIGHT = 900
const HOLD_MS = 1_600

test('the default view picker lists the views and the preview follows the pick', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  // Why: the band is off by default (ORCA-1148), and the preview this checks is the band's.
  await orcaPage.evaluate(async () => {
    const settings = await window.api.settings.set({ orchestratorGame: { band: true } })
    window.__store?.setState({ settings })
  })
  await attachRepoAndOpenTerminal(orcaPage, createShowcaseRepo())
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

  const hold = () => orcaPage.waitForTimeout(HOLD_MS)

  const defaultView = orcaPage.getByRole('combobox', { name: 'Default view' }).first()
  await defaultView.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await orcaPage.waitForTimeout(800)
  const clip = await showcaseClip(electronApp, testInfo, 'game-view-switcher')
  await hold()

  await defaultView.click()
  await expect(orcaPage.getByRole('option', { name: 'Flat · light' })).toBeVisible()
  await expect(orcaPage.getByRole('option', { name: 'Off · light' })).toBeVisible()
  await hold()

  await orcaPage.getByRole('option', { name: 'Flat · light' }).click()
  await expect(quest).toBeHidden()
  await hold()

  await defaultView.click()
  await orcaPage.getByRole('option', { name: 'Off · light' }).click()
  await expect(
    orcaPage.getByText('The game is off, so Agent Teams panes start as plain Claude.')
  ).toBeVisible()
  await hold()

  await defaultView.click()
  await orcaPage.getByRole('option', { name: 'Zen · medium' }).click()
  await expect(quest).toBeVisible()
  await hold()
  await clip.stop()
})
