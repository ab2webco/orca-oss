/**
 * ORCA-692 prototype (never merges): the mod's hd band with textured, sun-lit land, printed into a
 * real Orca terminal for each scene, at 1440/768/390/320 in both themes. Headful: a hidden E2E
 * window paints no frames.
 *
 *   ORCA_BAND_SCENE_DIR  folder of scene JSON files (a project's .orca/scenes); quest built-in if unset
 *   ORCA_BAND_SCENES     comma list of file names without .json (default minecraft,quest)
 *   ORCA_BAND_MOD_ROOT   another copy of resources/claude-plugins/orca-game, for the "before" capture
 *   ORCA_BAND_LABEL      prefix for the screenshot names (default after)
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build, type Plugin } from 'esbuild'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  execInTerminal,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const
const LABEL = process.env.ORCA_BAND_LABEL ?? 'after'
const SCENE_DIR = process.env.ORCA_BAND_SCENE_DIR ?? ''
const SCENE_NAMES = (process.env.ORCA_BAND_SCENES ?? 'minecraft,quest').split(',')
const MOD_ROOT = process.env.ORCA_BAND_MOD_ROOT ?? ''

// Why: the "before" capture bundles the same printer against an older copy of the mod.
const modRootPlugin = (root: string): Plugin => ({
  name: 'orca-game-root',
  setup(build) {
    build.onResolve({ filter: /resources\/claude-plugins\/orca-game\// }, (args) => {
      const tail = args.path.split('resources/claude-plugins/orca-game/')[1] ?? ''
      const base = resolve(root, tail)
      return { path: existsSync(`${base}.ts`) ? `${base}.ts` : join(base, 'index.ts') }
    })
  }
})

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(() =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

const bandRows = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      Object.values(window.__gameBand3d?.panes ?? {}).find((one) => !one.detached)?.detectedRows ??
      0
  )

test('hd band with textured, sun-lit land in a real terminal (ORCA-692) @headful', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(8 * 60_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage)
  await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setIgnoreMouseEvents(true)
  )
  // Why: the host's memory toast lands over the band corner; this capture is about the band.
  await orcaPage.addStyleTag({
    content:
      '[data-sonner-toaster],[data-testid="memory-pressure-warning"],[role="tooltip"]{display:none!important}'
  })
  // The POC WebGL overlay stays off: this capture is the mod's own cells.
  await orcaPage.evaluate(() => {
    window.localStorage.setItem('orca.poc.band3d', 'cells')
    window.dispatchEvent(new Event('orca:game-band-3d-choice'))
  })

  const printer = testInfo.outputPath('game-band-printer.mjs')
  await build({
    entryPoints: ['tests/e2e/fixtures/game-band-printer.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: printer,
    logLevel: 'warning',
    plugins: MOD_ROOT === '' ? [] : [modRootPlugin(MOD_ROOT)]
  })
  const ptyId = await waitForActivePanePtyId(orcaPage)
  const scenes =
    SCENE_DIR === '' ? [''] : SCENE_NAMES.map((name) => join(SCENE_DIR, `${name}.json`))

  for (const file of scenes) {
    const name =
      file === '' ? 'quest-built-in' : (file.split('/').at(-1) ?? 'scene').replace('.json', '')
    for (const [hourLabel, hour] of [
      ['day', 12],
      ['night', 22]
    ] as const) {
      await sendToTerminal(orcaPage, ptyId, '\u0003')
      await orcaPage.setViewportSize({ width: 1440, height: 900 })
      await execInTerminal(
        orcaPage,
        ptyId,
        `clear && ORCA_BAND_SCENE_FILE='${file}' ORCA_BAND_HOUR=${hour} node '${printer}'`
      )
      await expect
        .poll(() => bandRows(orcaPage), { timeout: 20_000, message: 'no hd band in the terminal' })
        .toBeGreaterThanOrEqual(9)
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        for (const theme of THEMES) {
          if (hourLabel === 'night' && width !== 1440) {
            continue
          }
          await setTheme(orcaPage, theme)
          await orcaPage.waitForTimeout(1200)
          await orcaPage.screenshot({
            path: testInfo.outputPath(`${LABEL}-${name}-${hourLabel}-${width}-${theme}.png`)
          })
        }
      }
    }
  }
})
