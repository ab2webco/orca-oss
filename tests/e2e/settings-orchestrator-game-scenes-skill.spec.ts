import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './helpers/settings-window'
import type { DiscoveredSkill, SkillDiscoveryResult } from '../../src/shared/skills'

type SkillDiscoveryMockGlobal = typeof globalThis & {
  __orcaGameScenesSkillDiscovery?: SkillDiscoveryResult
}

const SCENES_SKILL: DiscoveredSkill = {
  id: 'home-orca-game-scenes',
  name: 'orca-game-scenes',
  description: null,
  providers: ['agent-skills'],
  sourceKind: 'home',
  sourceLabel: 'home',
  rootPath: '/Users/test/.agents/skills',
  directoryPath: '/Users/test/.agents/skills/orca-game-scenes',
  skillFilePath: '/Users/test/.agents/skills/orca-game-scenes/SKILL.md',
  installed: true,
  updatedAt: null
}

async function setSkillDiscovery(
  app: ElectronApplication,
  skills: DiscoveredSkill[]
): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, result) => {
      const global_ = globalThis as SkillDiscoveryMockGlobal
      const isFirst = global_.__orcaGameScenesSkillDiscovery === undefined
      global_.__orcaGameScenesSkillDiscovery = result
      if (isFirst) {
        ipcMain.removeHandler('skills:discover')
        ipcMain.handle(
          'skills:discover',
          () => (globalThis as SkillDiscoveryMockGlobal).__orcaGameScenesSkillDiscovery
        )
      }
    },
    { skills, sources: [], scannedAt: Date.now() }
  )
}

test('the game section installs the scenes skill, shows its examples and renders at every width', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  // Why a stub: the isolated home has no skills, and a real install needs the network.
  await setSkillDiscovery(electronApp, [])
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'agents', repoId: null })
    state.openSettingsPage()
  })
  const card = orcaPage.locator('#orca-game-scenes-skill')
  await expect(card.getByRole('heading', { name: 'Game scenes skill' })).toBeVisible({
    timeout: 15_000
  })
  await card.getByRole('button', { name: 'Re-check' }).click()
  await expect(card.getByText('Not installed', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Install', exact: true })).toBeEnabled()
  const cliReady = await orcaPage.evaluate(async () => {
    const status = await window.api.cli.getInstallStatus()
    return status.state === 'installed' && status.pathConfigured === true
  })
  const notice = card.getByText('Before opening setup, Orca may show a system prompt', {
    exact: false
  })
  await expect(notice).toBeVisible({ visible: !cliReady })
  for (const title of ['Make a new scene', 'Change the colors', 'Fix a scene that draws Quest']) {
    await expect(card.getByRole('button', { name: title })).toBeVisible()
  }
  await card.getByRole('button', { name: 'Make a new scene' }).click()
  const dialog = orcaPage.getByRole('dialog')
  await expect(dialog).toContainText(
    'Use /orca-game-scenes to make a Super Smash Bros scene for this project and turn it on.'
  )
  await orcaPage.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  const shootCard = async (name: string): Promise<void> => {
    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        await card.evaluate((element) => element.scrollIntoView({ block: 'start' }))
        // Why: at phone widths the settings column itself overflows (ORCA-588); the card stays inside it.
        const excess = await card.evaluate((element) => {
          const column = element.parentElement?.getBoundingClientRect()
          const box = element.getBoundingClientRect()
          return column ? box.right - column.right : 0
        })
        expect(excess, `skill card wider than its column at ${width}px`).toBeLessThanOrEqual(0.5)
        await orcaPage.screenshot({ path: testInfo.outputPath(`${name}-${theme}-${width}.png`) })
      }
    }
    await setWindowWidth(electronApp, orcaPage, 1440)
  }
  await shootCard('scenes-skill-missing')

  await setSkillDiscovery(electronApp, [SCENES_SKILL])
  await card.getByRole('button', { name: 'Re-check' }).click()
  await expect(card.getByText('Not installed', { exact: true })).toBeHidden()
  await expect(card.getByRole('button', { name: 'Update', exact: true })).toBeEnabled()
  await expect(notice).toBeHidden()
  await shootCard('scenes-skill-installed')
})
