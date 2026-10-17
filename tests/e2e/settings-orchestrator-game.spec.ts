import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import type { GlobalSettings } from '../../src/shared/global-settings-types'
import {
  byScenePhase,
  sceneFile,
  sceneLook
} from '../../src/shared/__fixtures__/orchestrator-game-scene'

const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

/** The main window floors at 600px, so phone widths need the floor lifted first. */
async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

async function savedGameSettings(
  page: Page
): Promise<Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>> {
  return page.evaluate(async () => {
    const settings = await window.api.settings.get()
    return {
      orchestratorGame: settings.orchestratorGame,
      orchestratorGameProjects: settings.orchestratorGameProjects
    }
  })
}

async function shootAll(
  app: ElectronApplication,
  page: Page,
  testInfo: TestInfo,
  name: string,
  section: ReturnType<Page['locator']>
): Promise<void> {
  for (const theme of THEMES) {
    await setTheme(page, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(app, page, width)
      await section.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      await page.screenshot({ path: testInfo.outputPath(`${name}-${theme}-${width}.png`) })
    }
  }
}

test('global and per-project Agent Teams game settings persist and render at every width', async ({
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
  const globalSection = orcaPage.getByRole('radiogroup', { name: 'Game mode' }).first()
  await expect(globalSection).toBeVisible({ timeout: 15_000 })

  await globalSection.getByRole('radio', { name: 'Zen' }).click()
  await orcaPage.getByRole('switch', { name: 'Rewards' }).click()
  await expect
    .poll(async () => (await savedGameSettings(orcaPage)).orchestratorGame)
    .toEqual({ mode: 'zen', rewards: false })

  await shootAll(electronApp, orcaPage, testInfo, 'global', globalSection)

  await setWindowWidth(electronApp, orcaPage, 1440)
  const repoId = await orcaPage.evaluate(() => window.__store!.getState().repos[0]?.id ?? null)
  expect(repoId, 'the harness seeds one repo').not.toBeNull()
  await orcaPage.evaluate((id) => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'repo', repoId: id })
    state.openSettingsPage()
  }, repoId)

  const projectMode = orcaPage.getByRole('radiogroup', { name: 'Game mode' }).first()
  await expect(projectMode).toBeVisible({ timeout: 15_000 })
  await expect(orcaPage.getByText('Zen · global setting')).toBeVisible()

  await projectMode.getByRole('radio', { name: 'Off' }).click()
  await expect
    .poll(async () => (await savedGameSettings(orcaPage)).orchestratorGameProjects)
    .toEqual({ [repoId as string]: { mode: 'off' } })
  await expect(orcaPage.getByText('Off · this machine')).toBeVisible()

  await shootAll(electronApp, orcaPage, testInfo, 'project', projectMode)
})

const SPACE_PACK = {
  pluginKey: 'acme.space',
  consentFingerprint: 'sha256-e2e',
  name: 'Space Pack',
  version: '1.0.0',
  publisher: 'acme',
  status: 'idle',
  needsReconsent: false,
  isDev: false,
  official: false,
  bundled: false,
  capabilities: [],
  panels: [],
  commands: [],
  hasWorker: false,
  restarts: 0,
  gameScenes: ['acme.space/orbit']
}

test('the scene picker lists plugin scenes, keeps an uninstalled id and renders at every width', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  // Why: a real install needs the plugin system and consent; the picker only reads plugins:list.
  await electronApp.evaluate(({ ipcMain, BrowserWindow }, plugin) => {
    ipcMain.removeHandler('plugins:list')
    ipcMain.handle('plugins:list', async () => [plugin])
    BrowserWindow.getAllWindows()[0]?.webContents.send('plugins:changed', {})
  }, SPACE_PACK)

  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'agents', repoId: null })
    state.openSettingsPage()
  })
  const scene = orcaPage.getByRole('combobox', { name: 'Scene' }).first()
  await expect(scene).toBeVisible({ timeout: 15_000 })
  await expect(scene).toHaveText('Quest (built-in)')

  await scene.click()
  await orcaPage.getByRole('option', { name: 'orbit · Space Pack' }).click()
  await expect
    .poll(async () => (await savedGameSettings(orcaPage)).orchestratorGame)
    .toEqual({ scene: 'acme.space/orbit' })
  await expect(scene).toHaveText('orbit · Space Pack')
  await shootAll(electronApp, orcaPage, testInfo, 'scene-picked', scene)

  for (const theme of THEMES) {
    await setTheme(orcaPage, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      await scene.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      await scene.click()
      await expect(orcaPage.getByRole('listbox')).toBeVisible()
      // Why: Radix fades the list in; a mid-animation capture reads as a washed-out control.
      await orcaPage.waitForFunction(() =>
        (
          document
            .querySelector('[role="listbox"]')
            ?.parentElement?.getAnimations({ subtree: true }) ?? []
        ).every((animation) => animation.playState !== 'running')
      )
      await orcaPage.screenshot({ path: testInfo.outputPath(`scene-open-${theme}-${width}.png`) })
      await orcaPage.keyboard.press('Escape')
      await expect(orcaPage.getByRole('listbox')).toBeHidden()
    }
  }

  await setWindowWidth(electronApp, orcaPage, 1440)
  await orcaPage.evaluate(async () => {
    const settings = await window.api.settings.set({
      orchestratorGame: { scene: 'acme.gone/orbit' }
    })
    window.__store?.setState({ settings })
  })
  await expect(scene).toHaveText('acme.gone/orbit (not installed)')
  await shootAll(electronApp, orcaPage, testInfo, 'scene-missing', scene)
})

/** Distinct colors on the preview canvas; a blank or one-color canvas means nothing was painted. */
async function previewColors(preview: ReturnType<Page['locator']>): Promise<number> {
  return preview.evaluate((canvas) => {
    const context = (canvas as HTMLCanvasElement).getContext('2d')
    const data = context?.getImageData(0, 0, (canvas as HTMLCanvasElement).width, 40).data
    const colors = new Set<number>()
    for (let index = 0; data && index < data.length; index += 4) {
      colors.add(
        ((data[index] ?? 0) << 16) | ((data[index + 1] ?? 0) << 8) | (data[index + 2] ?? 0)
      )
    }
    return colors.size
  })
}

test('the game section says it is for Claude Agent Teams only and previews the picked scene', async ({
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
  const heading = orcaPage.getByRole('heading', { name: 'Agent Teams game' }).first()
  await expect(heading).toBeVisible({ timeout: 15_000 })
  await expect(
    orcaPage.getByText('Applies only to Claude Agent Teams panes.', { exact: false }).first()
  ).toBeVisible()

  const quest = orcaPage.getByRole('img', { name: 'Preview of Quest (built-in)' })
  await expect(quest).toBeVisible()
  await expect.poll(async () => previewColors(quest)).toBeGreaterThan(8)

  const scene = orcaPage.getByRole('combobox', { name: 'Scene' }).first()
  await scene.click()
  await orcaPage.getByRole('option', { name: 'Night Watch (built-in)' }).click()
  const nightWatch = orcaPage.getByRole('img', { name: 'Preview of Night Watch (built-in)' })
  await expect(nightWatch).toBeVisible()
  await expect.poll(async () => previewColors(nightWatch)).toBeGreaterThan(8)

  for (const theme of THEMES) {
    await setTheme(orcaPage, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      await heading.evaluate((element) => element.scrollIntoView({ block: 'start' }))
      // Why: the canvas has a 512px drawing buffer; it must scale down, not widen its column.
      const fits = await nightWatch.evaluate((canvas) => {
        const column = canvas.closest('section')?.getBoundingClientRect().width ?? 0
        return canvas.getBoundingClientRect().width <= column
      })
      expect(fits, `preview wider than its column at ${width}px`).toBe(true)
      // Why: at phone widths the settings column itself overflows (ORCA-588); the art stays on screen.
      const box = await nightWatch.evaluate((canvas) => {
        const rect = canvas.getBoundingClientRect()
        return { left: rect.left, right: rect.right, viewport: window.innerWidth }
      })
      expect(
        box.right - box.left,
        `preview wider than the window at ${width}px`
      ).toBeLessThanOrEqual(box.viewport)
      await orcaPage.screenshot({ path: testInfo.outputPath(`preview-${theme}-${width}.png`) })
    }
  }

  await setWindowWidth(electronApp, orcaPage, 1440)
  await orcaPage
    .getByRole('radiogroup', { name: 'Game mode' })
    .first()
    .getByRole('radio', { name: 'Off' })
    .click()
  await expect(nightWatch).toBeHidden()
  await expect(
    orcaPage.getByText('The game is off, so Agent Teams panes start as plain Claude.')
  ).toBeVisible()
  await heading.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await orcaPage.screenshot({ path: testInfo.outputPath('preview-off-1440.png') })
})

test("a project's scene file previews when valid, says why when not, and renders at every width", async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  const repo = await orcaPage.evaluate(() => {
    const first = window.__store!.getState().repos[0]
    return first ? { id: first.id, path: first.path } : null
  })
  expect(repo, 'the harness seeds one repo').not.toBeNull()
  const { id: repoId, path: repoPath } = repo as { id: string; path: string }
  // Why a magenta sky: a preview that paints it can only be drawing the file, never Quest.
  // Why a spring-green pet: the preview draws the file's cast with the game's own code.
  mkdirSync(join(repoPath, '.orca', 'scenes'), { recursive: true })
  const pet = {
    name: 'Sprout',
    frames: [['PPPP', 'P..P']],
    happy: ['PPPP', 'PPPP'],
    colors: { P: '#00ff7f' }
  }
  writeFileSync(
    join(repoPath, '.orca', 'scenes', 'space.json'),
    JSON.stringify(
      sceneFile({ looks: byScenePhase({ ...sceneLook, skyTop: '#ff00ff' }), cast: { pet } }),
      null,
      2
    )
  )
  writeFileSync(
    join(repoPath, '.orca', 'scenes', 'broken.json'),
    JSON.stringify(sceneFile({ band: 1 }))
  )

  await orcaPage.evaluate((id) => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'repo', repoId: id })
    state.openSettingsPage()
  }, repoId)
  const scene = orcaPage.getByRole('combobox', { name: 'Scene' }).first()
  await expect(scene).toBeVisible({ timeout: 15_000 })
  await scene.click()
  await orcaPage.getByRole('option', { name: 'Custom file…' }).click()

  const path = orcaPage.getByRole('textbox', { name: 'Scene file' })
  await expect(path).toBeVisible()
  await expect(orcaPage.getByRole('button', { name: 'Choose file…' })).toBeVisible()
  await expect(orcaPage.getByRole('button', { name: 'Create from Quest (built-in)' })).toBeVisible()
  await path.fill('.orca/scenes/space.json')
  await path.press('Enter')
  await expect
    .poll(async () => (await savedGameSettings(orcaPage)).orchestratorGameProjects)
    .toEqual({ [repoId]: { sceneFile: '.orca/scenes/space.json' } })

  const preview = orcaPage.getByRole('img', { name: 'Preview of space (custom)' })
  await expect(preview).toBeVisible()
  const pixelsOf = (rgb: readonly [number, number, number]) =>
    preview.evaluate((canvas, [red, green, blue]) => {
      const element = canvas as HTMLCanvasElement
      const data = element.getContext('2d')?.getImageData(0, 0, element.width, element.height).data
      let count = 0
      for (let index = 0; data && index < data.length; index += 4) {
        if (data[index] === red && data[index + 1] === green && data[index + 2] === blue) {
          count += 1
        }
      }
      return count
    }, rgb)
  await expect.poll(async () => pixelsOf([255, 0, 255])).toBeGreaterThan(0)
  await expect.poll(async () => pixelsOf([0, 255, 127])).toBeGreaterThan(0)
  await expect(orcaPage.getByText('.orca/scenes/space.json · this machine')).toBeVisible()
  await shootAll(electronApp, orcaPage, testInfo, 'scene-file-valid', path)

  await setWindowWidth(electronApp, orcaPage, 1440)
  await path.fill('.orca/scenes/broken.json')
  await path.press('Enter')
  const alert = orcaPage.getByRole('alert').filter({ hasText: "This file can't be drawn" })
  await expect(alert).toContainText('so the game draws Quest: band: ')
  await expect(
    orcaPage.getByText('Until the scene file is valid, the game draws Quest.')
  ).toBeVisible()
  await expect(orcaPage.getByRole('img', { name: 'Preview of Quest (built-in)' })).toBeVisible()
  await shootAll(electronApp, orcaPage, testInfo, 'scene-file-invalid', path)
})

test("the project's scene files are listed in the Scene picker and picking one selects it", async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  const repo = await orcaPage.evaluate(() => {
    const first = window.__store!.getState().repos[0]
    return first ? { id: first.id, path: first.path } : null
  })
  expect(repo, 'the harness seeds one repo').not.toBeNull()
  const { id: repoId, path: repoPath } = repo as { id: string; path: string }
  mkdirSync(join(repoPath, '.orca', 'scenes'), { recursive: true })
  writeFileSync(
    join(repoPath, '.orca', 'scenes', 'deep-space.json'),
    JSON.stringify(sceneFile({ looks: byScenePhase({ ...sceneLook, skyTop: '#ff00ff' }) }), null, 2)
  )

  await orcaPage.evaluate((id) => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'repo', repoId: id })
    state.openSettingsPage()
  }, repoId)
  const scene = orcaPage.getByRole('combobox', { name: 'Scene' }).first()
  await expect(scene).toBeVisible({ timeout: 15_000 })
  await scene.click()
  await orcaPage.getByRole('option', { name: 'deep-space (custom)' }).click()
  await expect
    .poll(async () => (await savedGameSettings(orcaPage)).orchestratorGameProjects)
    .toEqual({ [repoId]: { sceneFile: '.orca/scenes/deep-space.json' } })
  await expect(scene).toHaveText('deep-space (custom)')
  await expect(orcaPage.getByRole('img', { name: 'Preview of deep-space (custom)' })).toBeVisible()
  await shootAll(electronApp, orcaPage, testInfo, 'scene-file-listed', scene)

  for (const theme of THEMES) {
    await setTheme(orcaPage, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      await scene.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      await scene.click()
      await expect(orcaPage.getByRole('listbox')).toBeVisible()
      await orcaPage.waitForFunction(() =>
        (
          document
            .querySelector('[role="listbox"]')
            ?.parentElement?.getAnimations({ subtree: true }) ?? []
        ).every((animation) => animation.playState !== 'running')
      )
      await orcaPage.screenshot({
        path: testInfo.outputPath(`scene-files-open-${theme}-${width}.png`)
      })
      await orcaPage.keyboard.press('Escape')
      await expect(orcaPage.getByRole('listbox')).toBeHidden()
    }
  }
})

test("the project lead shows orca.yaml's values, overrides them on this machine and renders at every width", async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  const repo = await orcaPage.evaluate(() => {
    const first = window.__store!.getState().repos[0]
    return first ? { id: first.id, path: first.path } : null
  })
  expect(repo, 'the harness seeds one repo').not.toBeNull()
  const { id: repoId, path: repoPath } = repo as { id: string; path: string }
  writeFileSync(
    join(repoPath, 'orca.yaml'),
    'orchestratorGame:\n  orchestrator:\n    autostart: true\n    cap: 6\n'
  )

  await orcaPage.evaluate((id) => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'repo', repoId: id })
    state.openSettingsPage()
  }, repoId)
  const lead = orcaPage.locator('[data-slot="game-lead-settings"]')
  await expect(lead).toBeVisible({ timeout: 15_000 })
  await expect(lead.getByText('On · from orca.yaml')).toBeVisible()
  await expect(lead.getByText('6 · from orca.yaml')).toBeVisible()
  await expect(lead.getByText('claude · default')).toBeVisible()

  await lead
    .getByRole('radiogroup', { name: 'Start as lead' })
    .getByRole('radio', { name: 'Off' })
    .click()
  const model = lead.getByRole('textbox', { name: 'Model' })
  await model.fill('opus')
  await model.press('Enter')
  await expect
    .poll(async () => (await savedGameSettings(orcaPage)).orchestratorGameProjects)
    .toEqual({ [repoId]: { orchestrator: { autostart: false, model: 'opus' } } })
  await expect(lead.getByText('Off · this machine')).toBeVisible()
  await expect(lead.getByText('opus · this machine')).toBeVisible()

  await expect(lead.getByText("Orca's account · default")).toBeVisible()
  await lead
    .getByRole('radiogroup', { name: 'Member accounts' })
    .getByRole('radio', { name: 'Most free' })
    .click()
  await expect
    .poll(async () => (await savedGameSettings(orcaPage)).orchestratorGameProjects)
    .toEqual({ [repoId]: { orchestrator: { autostart: false, model: 'opus', accounts: 'auto' } } })
  await expect(lead.getByText('Most free quota · this machine')).toBeVisible()

  const cap = lead.getByRole('textbox', { name: 'Member cap' })
  await cap.fill('40')
  await cap.press('Enter')
  await expect(lead.getByRole('alert')).toHaveText('Enter a whole number from 1 to 12.')
  expect((await savedGameSettings(orcaPage)).orchestratorGameProjects).toEqual({
    [repoId]: { orchestrator: { autostart: false, model: 'opus', accounts: 'auto' } }
  })

  const yamlOnly = lead.getByText('The launch prompt and the project', { exact: false })
  for (const theme of THEMES) {
    await setTheme(orcaPage, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      // Why: a lead field must never be wider than the section it sits in.
      const overflow = await lead.evaluate((section) => {
        const right = section.getBoundingClientRect().right
        return Array.from(section.querySelectorAll('input, [role="radiogroup"]'))
          .map((element) => element.getBoundingClientRect().right - right)
          .filter((excess) => excess > 0.5)
      })
      expect(overflow, `a lead control overflows its section at ${width}px`).toEqual([])
      await lead.evaluate((element) => element.scrollIntoView({ block: 'start' }))
      await orcaPage.screenshot({ path: testInfo.outputPath(`lead-top-${theme}-${width}.png`) })
      await yamlOnly.evaluate((element) => element.scrollIntoView({ block: 'end' }))
      await orcaPage.screenshot({ path: testInfo.outputPath(`lead-end-${theme}-${width}.png`) })
    }
  }
})

test("the project's Actions editor saves this machine's list and renders at every width", async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  const repoId = await orcaPage.evaluate(() => window.__store!.getState().repos[0]?.id ?? null)
  expect(repoId, 'the harness seeds one repo').not.toBeNull()
  await orcaPage.evaluate((id) => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'repo', repoId: id })
    state.openSettingsPage()
  }, repoId)

  await expect(orcaPage.getByRole('radiogroup', { name: 'Lead buttons' })).toBeVisible({
    timeout: 15_000
  })
  await expect(orcaPage.getByRole('radiogroup', { name: 'Open links in' }).first()).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Edit on this machine' }).click()
  for (const [label, command, prompt] of [
    ['Test runs', 'test-runs', 'Have members run the Tambora test runs of my QA tickets'],
    ['Daily log', 'daily', 'Write the daily log of what the members did']
  ] as const) {
    await orcaPage.getByRole('button', { name: 'Add action' }).click()
    const n = await orcaPage.locator('[data-slot="game-action-row"]').count()
    await orcaPage.getByLabel(`Label ${n}`).fill(label)
    await orcaPage.getByLabel(`Command ${n}`).fill(command)
    await orcaPage.getByLabel(`Prompt ${n}`).fill(prompt)
  }
  await orcaPage.getByLabel('Key 2').fill('x')
  await orcaPage.getByRole('button', { name: 'Save actions' }).click()
  await expect
    .poll(async () => (await savedGameSettings(orcaPage)).orchestratorGameProjects)
    .toEqual({
      [repoId as string]: {
        actions: [
          {
            label: 'Test runs',
            command: 'test-runs',
            prompt: 'Have members run the Tambora test runs of my QA tickets'
          },
          {
            label: 'Daily log',
            command: 'daily',
            key: 'x',
            prompt: 'Write the daily log of what the members did'
          }
        ]
      }
    })

  // An MCP row with a refused command shows the inline error the screenshots should carry.
  await orcaPage.getByRole('button', { name: 'Add action' }).click()
  await orcaPage.getByLabel('Label 3').fill('Runs')
  await orcaPage.getByLabel('Command 3').fill('wave')
  await orcaPage
    .getByRole('radiogroup', { name: 'Kind 3' })
    .getByRole('radio', { name: 'MCP' })
    .click()
  await orcaPage.getByLabel('MCP server 3').fill('tambora')
  await orcaPage.getByLabel('Tool 3').fill('list_test_runs')
  await expect(orcaPage.getByRole('alert')).toHaveText(
    'A lead button or another action already uses this command.'
  )
  await expect(orcaPage.getByRole('button', { name: 'Save actions' })).toBeDisabled()

  const editor = orcaPage.locator('[data-slot="game-actions-settings"]')
  await shootAll(electronApp, orcaPage, testInfo, 'actions', editor)
  // Why a box check: at phone widths the editor is taller than the window, so no shot holds all of it.
  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    const box = await editor.boundingBox()
    expect(box?.width ?? 0, `editor fits ${width}`).toBeLessThanOrEqual(width)
  }
})
